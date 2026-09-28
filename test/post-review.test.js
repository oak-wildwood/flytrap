import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReview, postReview } from '../src/post-review.js';
import { MARKER } from '../src/render.js';
import { fakeApi, fixture } from './helpers.js';

const denialExecution = () => fixture('execution-denial.json');

test('plans one PR comment: Verdict, then summary, then Findings', () => {
  const plan = planReview({ raw: fixture('findings-request-changes.json'), prNumber: 7 });

  assert.equal(plan.actions.length, 1);
  const [action] = plan.actions;
  assert.equal(action.method, 'POST');
  assert.equal(action.path, '/issues/7/comments');
  assert.equal(action.body, `${MARKER}
## Flytrap: ❌ Request Changes

Changes \`add\` to subtract, which breaks every caller.

### Findings (2)

- **Blocker** · Correctness · \`src/add.js:2-3\`: add() now subtracts
  \`a - b\` returns the difference.
  Use \`a + b\`.
  \`\`\`
    return a + b;
  }
  \`\`\`
- **Nitpick** · Maintainability · \`src/add.js:2\`: Name no longer matches behavior
  If subtraction is intended, rename the function.
`);
});

test('says so when there are no Findings', () => {
  const { actions } = planReview({ raw: fixture('findings-approve.json'), prNumber: 7 });
  assert.equal(actions[0].body, `${MARKER}
## Flytrap: ✅ Approve

A small, correct change.

No findings.
`);
});

test('breaks @mentions in model-written text', () => {
  const raw = JSON.stringify({
    verdict: 'approve_with_suggestions',
    summary: 'cc @oak-wildwood/everyone',
    findings: [{ file: 'a.js', line: 1, category: 'testing', severity: 'suggestion', title: 'ping @oak', body: 'hi @someone' }],
  });
  const { body } = planReview({ raw, prNumber: 7 }).actions[0];
  assert.doesNotMatch(body, /@[A-Za-z]/);
  assert.match(body, /@​oak-wildwood\/everyone/);
});

for (const raw of [undefined, '', '   \n']) {
  test(`fails when structured_output is ${JSON.stringify(raw)}`, () => {
    assert.throws(() => planReview({ raw, prNumber: 7 }), /no structured output/);
  });
}

test('fails on output that is not JSON', () => {
  assert.throws(() => planReview({ raw: 'Here is my review!', prNumber: 7 }), /not JSON/);
});

test('fails on output that breaks the schema', () => {
  assert.throws(
    () => planReview({ raw: fixture('findings-bad-severity.json'), prNumber: 7 }),
    (err) => /\$\.findings\[0\]\.category should be one of/.test(err.message)
      && /\$\.findings\[0\]\.severity should be one of/.test(err.message),
  );
});

test('fails without a PR number', () => {
  assert.throws(() => planReview({ raw: fixture('findings-approve.json'), prNumber: NaN }), /pull request number/);
});

test('fails on a permission denial, naming the tool and its input', () => {
  assert.throws(
    () => planReview({ raw: fixture('findings-approve.json'), executionRaw: denialExecution(), prNumber: 7 }),
    /denied permission to use Bash with input \{"command":"rm -rf \/"\}/,
  );
});

test('truncates a large denied input so the failure reason stays readable', () => {
  const content = 'x'.repeat(10_000);
  const executionRaw = JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.js', content } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Claude requested permissions to use Write.' }] } },
    { type: 'result', permission_denials: [{ tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: 'a.js', content } }] },
  ]);
  assert.throws(
    () => planReview({ raw: fixture('findings-approve.json'), executionRaw, prNumber: 7 }),
    (err) => {
      assert.match(err.message, /denied permission to use Write with input \{"file_path":"a\.js"/);
      assert.match(err.message, /… \(\d+ chars\)$/);
      assert.ok(err.message.length < 500);
      return true;
    },
  );
});

test('checks for a denial even when there is no findings JSON at all', () => {
  assert.throws(
    () => planReview({ raw: '', executionRaw: denialExecution(), prNumber: 7 }),
    /denied permission to use Bash/,
  );
});

test('a clean execution transcript does not affect a valid Review', () => {
  const plan = planReview({ raw: fixture('findings-approve.json'), executionRaw: fixture('execution-clean.json'), prNumber: 7 });
  assert.equal(plan.actions.length, 1);
});

test('posts exactly what it planned', async () => {
  const raw = fixture('findings-request-changes.json');
  const api = fakeApi();
  const plan = await postReview({ raw, prNumber: 7, api });

  assert.deepEqual(api.calls, [['createComment', 7, plan.actions[0].body]]);
});

test('posts nothing when the output is invalid', async () => {
  const api = fakeApi();
  await assert.rejects(postReview({ raw: '', prNumber: 7, api }));
  assert.deepEqual(api.calls, []);
});

test('posts nothing on a permission denial, even with valid findings', async () => {
  const api = fakeApi();
  await assert.rejects(
    postReview({ raw: fixture('findings-approve.json'), executionRaw: denialExecution(), prNumber: 7, api }),
    /denied permission to use Bash/,
  );
  assert.deepEqual(api.calls, []);
});
