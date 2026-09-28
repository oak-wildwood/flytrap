import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, buildPrompt, MAX_DIFF_CHARS } from '../src/prepare.js';
import { loadSchema } from '../src/schema.js';
import { fakeApi, fixture, jsonFixture } from './helpers.js';

const event = () => jsonFixture('event-pr-comment.json');

for (const permission of ['write', 'maintain', 'admin']) {
  test(`proceeds for a commenter with ${permission} permission`, async () => {
    // The permission field reports maintain as write; role_name keeps it.
    const api = fakeApi({ permission: permission === 'maintain' ? 'write' : permission, roleName: permission });
    const result = await prepare({ event: event(), api });

    assert.equal(result.proceed, true);
    assert.equal(result.outputs.pr_number, 7);
    assert.equal(result.outputs.is_fork, false);
    assert.equal(result.outputs.checkout_ref, 'refs/pull/7/head');
    assert.deepEqual(api.calls.map(([name]) => name), ['getPermission', 'getPull', 'addReaction', 'getDiff']);
    assert.deepEqual(api.calls[0], ['getPermission', 'oak']);
    assert.deepEqual(api.calls[2], ['addReaction', 1001, 'eyes']);
    assert.equal(result.outputs.reaction_id, 42);
    assert.equal(result.outputs.comment_id, 1001);
  });
}

for (const permission of ['read', 'triage', 'none']) {
  test(`stops with a reason, before touching the PR, for ${permission} permission`, async () => {
    const api = fakeApi({ permission: permission === 'triage' ? 'read' : permission, roleName: permission });
    const result = await prepare({ event: event(), api });

    assert.equal(result.proceed, false);
    assert.match(result.reason, new RegExp(`@oak has ${permission} permission`));
    assert.match(result.reason, /write, maintain or admin/);
    assert.equal(result.outputs, undefined);
    // Only the permission check ran: no PR fetch, so no checkout ref and no prompt for the model.
    assert.deepEqual(api.calls.map(([name]) => name), ['getPermission']);
  });
}

test('checks out a fork PR through the base repository', async () => {
  const api = fakeApi({ permission: 'write', pull: 'pull-fork.json' });
  const result = await prepare({ event: event(), api });

  assert.equal(result.proceed, true);
  assert.equal(result.outputs.is_fork, true);
  assert.equal(result.outputs.head_sha, '2222222222222222222222222222222222222222');
  assert.equal(result.outputs.checkout_ref, 'refs/pull/7/head');
});

test('still checks permission first on a fork PR from a read-only commenter', async () => {
  const api = fakeApi({ permission: 'read', pull: 'pull-fork.json' });
  const result = await prepare({ event: event(), api });

  assert.equal(result.proceed, false);
  assert.deepEqual(api.calls.map(([name]) => name), ['getPermission']);
});

test('ignores bot comments without looking anything up', async () => {
  const api = fakeApi({ permission: 'admin' });
  const result = await prepare({ event: jsonFixture('event-bot-comment.json'), api });

  assert.equal(result.proceed, false);
  assert.match(result.reason, /some-automation\[bot\] is a bot/);
  assert.deepEqual(api.calls, []);
});

test('ignores comments on issues', async () => {
  const api = fakeApi({ permission: 'admin' });
  const result = await prepare({ event: jsonFixture('event-issue-comment.json'), api });

  assert.equal(result.proceed, false);
  assert.match(result.reason, /not a comment on a pull request/);
  assert.deepEqual(api.calls, []);
});

test('ignores PR comments that do not mention @flytrap', async () => {
  for (const body of ['looks good', 'email me at x@flytrap.dev', '@flytrapery']) {
    const e = event();
    e.comment.body = body;
    const api = fakeApi({ permission: 'admin' });
    const result = await prepare({ event: e, api });

    assert.equal(result.proceed, false, body);
    assert.match(result.reason, /does not mention @flytrap/);
    assert.deepEqual(api.calls, []);
  }
});

test('stops on a closed pull request', async () => {
  const api = fakeApi({ permission: 'write' });
  api.getPull = async () => ({ ...jsonFixture('pull-same-repo.json'), state: 'closed' });
  const result = await prepare({ event: event(), api });

  assert.equal(result.proceed, false);
  assert.match(result.reason, /#7 is closed/);
  assert.ok(!api.calls.some(([name]) => name === 'addReaction'), 'no 👀 when nothing will be posted');
});

test('still reviews when the 👀 reaction fails, and says why', async () => {
  const api = fakeApi({ permission: 'write' });
  api.addReaction = async () => { throw new Error('GitHub POST failed: 403'); };
  const warnings = [];
  const result = await prepare({ event: event(), api, warn: (m) => warnings.push(m) });

  assert.equal(result.proceed, true);
  assert.equal(result.outputs.reaction_id, '');
  assert.deepEqual(warnings, ['could not react to the comment: GitHub POST failed: 403']);
});

test('gives the Harness the rubric, the diff and the findings schema', async () => {
  const api = fakeApi({ permission: 'write' });
  const { outputs } = await prepare({ event: event(), api });

  assert.match(outputs.prompt, /# Flytrap Review/);
  assert.doesNotMatch(outputs.prompt, /^---\nname:/, 'skill frontmatter is stripped');
  assert.ok(outputs.prompt.includes(fixture('pr.diff')));
  assert.match(outputs.prompt, /Pull request: #7/);
  const { $schema, $id, ...rest } = loadSchema();
  assert.deepEqual(JSON.parse(outputs.json_schema), rest);
  // The Claude CLI rejects the draft 2020-12 $schema URI (first live run, #14).
  assert.ok(!('$schema' in JSON.parse(outputs.json_schema)));
  // action.yml passes the schema inside single quotes in claude_args.
  assert.ok(!outputs.json_schema.includes("'"));
});

test('fences the diff so backticks in it cannot close the fence', () => {
  const pull = jsonFixture('pull-same-repo.json');
  const prompt = buildPrompt({ repository: 'o/r', pull, diff: '+ const s = ````;\n' });
  assert.match(prompt, /^`````diff$/m);
});

test('cuts an oversized diff and says so', () => {
  const pull = jsonFixture('pull-same-repo.json');
  const prompt = buildPrompt({ repository: 'o/r', pull, diff: 'x'.repeat(MAX_DIFF_CHARS + 10) });
  assert.match(prompt, /cut to the first/);
  assert.ok(!prompt.includes('x'.repeat(MAX_DIFF_CHARS + 1)));
});

test('a failure after the 👀 still carries the ids the swap step needs', async () => {
  const api = fakeApi({ permission: 'write' });
  api.getDiff = async () => { throw new Error('GitHub GET failed: 502'); };

  await assert.rejects(prepare({ event: event(), api }), (err) => {
    assert.match(err.message, /502/);
    assert.deepEqual(err.outputs, { comment_id: 1001, reaction_id: 42 });
    return true;
  });
});
