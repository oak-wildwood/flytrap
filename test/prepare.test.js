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
    assert.deepEqual(api.calls.map(([name]) => name), ['getPermission', 'getPull', 'getDiff']);
    assert.deepEqual(api.calls[0], ['getPermission', 'oak']);
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

test('ignores comments on issues', async () => {
  const api = fakeApi({ permission: 'admin' });
  const result = await prepare({ event: jsonFixture('event-issue-comment.json'), api });

  assert.equal(result.proceed, false);
  assert.match(result.reason, /not a comment on a pull request/);
  assert.deepEqual(api.calls, []);
});

test('ignores PR comments that do not mention @nuthatch', async () => {
  for (const body of ['looks good', 'email me at x@nuthatch.dev', '@nuthatchery']) {
    const e = event();
    e.comment.body = body;
    const api = fakeApi({ permission: 'admin' });
    const result = await prepare({ event: e, api });

    assert.equal(result.proceed, false, body);
    assert.match(result.reason, /does not mention @nuthatch/);
    assert.deepEqual(api.calls, []);
  }
});

test('stops on a closed pull request', async () => {
  const api = fakeApi({ permission: 'write' });
  api.getPull = async () => ({ ...jsonFixture('pull-same-repo.json'), state: 'closed' });
  const result = await prepare({ event: event(), api });

  assert.equal(result.proceed, false);
  assert.match(result.reason, /#7 is closed/);
});

test('gives the Harness the rubric, the diff and the findings schema', async () => {
  const api = fakeApi({ permission: 'write' });
  const { outputs } = await prepare({ event: event(), api });

  assert.match(outputs.prompt, /# Nuthatch Review/);
  assert.doesNotMatch(outputs.prompt, /^---\nname:/, 'skill frontmatter is stripped');
  assert.ok(outputs.prompt.includes(fixture('pr.diff')));
  assert.match(outputs.prompt, /Pull request: #7/);
  assert.deepEqual(JSON.parse(outputs.json_schema), loadSchema());
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
