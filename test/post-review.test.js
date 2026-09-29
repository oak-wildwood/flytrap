import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRun, planReview, postReview } from '../src/post-review.js';
import { MARKER } from '../src/render.js';
import { fakeApi, fixture, jsonFixture } from './helpers.js';

const SHA = '1111111111111111111111111111111111111111';
const denialExecution = () => fixture('execution-denial.json');

// Plans a review of Findings against test/fixtures/review.diff, which has:
//   docs/notes.md  new lines 1-4 and 31-33 (an added line in the first hunk starts with "+++ ")
//   src/math.js    new lines 1-4 and 20-26
//   src/old.js     deleted
function plan(findings, { verdict = 'approve_with_suggestions', summary = 'A summary.' } = {}) {
  const raw = JSON.stringify({ verdict, summary, findings });
  const { actions } = planReview({ raw, prNumber: 7, diff: fixture('review.diff'), commitId: SHA });
  assert.equal(actions.length, 1);
  return actions[0];
}

// Every inline comment starts with its hidden fingerprint; most tests are about the rest.
const FINGERPRINT = /^<!-- flytrap:finding [0-9a-f]{16} -->\n/;
function withoutFingerprint(comment) {
  assert.match(comment.body, FINGERPRINT);
  return { ...comment, body: comment.body.replace(FINGERPRINT, '') };
}

function finding(fields) {
  return { category: 'correctness', severity: 'suggestion', title: 'A title', body: 'A body.', ...fields };
}

test('plans one COMMENT review on the reviewed commit', () => {
  const action = plan([finding({ file: 'src/math.js', line: 2 })], { verdict: 'request_changes' });
  assert.equal(action.type, 'review');
  assert.equal(action.method, 'POST');
  assert.equal(action.path, '/pulls/7/reviews');
  assert.equal(action.body.event, 'COMMENT');
  assert.equal(action.body.commit_id, SHA);
});

test('the review event is COMMENT whatever the Verdict', () => {
  for (const verdict of ['approve', 'approve_with_suggestions', 'request_changes']) {
    assert.equal(plan([], { verdict }).body.event, 'COMMENT');
  }
});

test('a Finding inside a hunk posts inline on its line', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 2, title: 'add() now subtracts', body: 'Use `a + b`.' })]);
  assert.deepEqual(body.comments.map(withoutFingerprint), [{
    path: 'src/math.js',
    line: 2,
    side: 'RIGHT',
    body: '**Suggestion** · Correctness: add() now subtracts\n\nUse `a + b`.\n',
  }]);
  assert.match(body.body, /^1 is an inline comment on the diff\.$/m);
});

test('a Finding on a context line of a hunk also posts inline', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 26 })]);
  assert.equal(body.comments[0].line, 26);
});

test('a range posts inline from start_line to line', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 21, end_line: 23 })]);
  const [comment] = body.comments;
  assert.equal(comment.start_line, 21);
  assert.equal(comment.start_side, 'RIGHT');
  assert.equal(comment.line, 23);
  assert.equal(comment.side, 'RIGHT');
});

test('an end_line equal to line is a single-line comment', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 2, end_line: 2 })]);
  assert.equal(body.comments[0].line, 2);
  assert.ok(!('start_line' in body.comments[0]));
});

test('a line after an added "+++ " line is still placed in its hunk', () => {
  const { body } = plan([finding({ file: 'docs/notes.md', line: 32 })]);
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].path, 'docs/notes.md');
});

test('Findings outside the diff are listed in the summary, and the review still posts', () => {
  const outside = [
    finding({ file: 'src/math.js', line: 10, title: 'between hunks' }),
    finding({ file: 'src/other.js', line: 1, title: 'file not in the diff' }),
    finding({ file: 'src/math.js', line: 3, end_line: 21, title: 'range across two hunks' }),
    finding({ file: 'src/old.js', line: 1, title: 'deleted file' }),
    finding({ file: 'src/math.js', line: 26, end_line: 27, title: 'range running past the hunk' }),
  ];
  const action = plan(outside);
  assert.equal(action.body.event, 'COMMENT');
  assert.deepEqual(action.body.comments, []);
  assert.match(action.body.body, /^5 are outside the diff, so they are listed here:$/m);
  assert.doesNotMatch(action.body.body, /inline/);
  for (const { title } of outside) assert.ok(action.body.body.includes(`: ${title}\n`), title);
  assert.ok(action.body.body.includes('`src/math.js:3-21`'));
});

test('a suggestion renders as a suggested-change block', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 2, body: 'Use `a + b`.', suggestion: '  return a + b;\n' })]);
  assert.equal(withoutFingerprint(body.comments[0]).body, `**Suggestion** · Correctness: A title

Use \`a + b\`.

\`\`\`suggestion
  return a + b;
\`\`\`
`);
});

test('a suggestion containing backticks gets a longer fence', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 2, suggestion: 'const s = ```x```;' })]);
  assert.ok(body.comments[0].body.endsWith('````suggestion\nconst s = ```x```;\n````\n'));
});

test('a suggestion outside the diff is shown as plain code in the summary', () => {
  const { body } = plan([finding({ file: 'src/math.js', line: 10, suggestion: 'x();' })]);
  assert.ok(body.body.includes('  ```\n  x();\n  ```'));
  assert.doesNotMatch(body.body, /```suggestion/);
});

test('a mix of Findings: inline ones as comments, the rest in the summary, by Severity', () => {
  const { actions } = planReview({
    raw: fixture('findings-mix.json'),
    prNumber: 7,
    diff: fixture('review.diff'),
    commitId: SHA,
  });
  actions[0].body.comments = actions[0].body.comments.map(withoutFingerprint);
  assert.deepEqual(actions, [{
    type: 'review',
    method: 'POST',
    path: '/pulls/7/reviews',
    body: {
      commit_id: SHA,
      event: 'COMMENT',
      body: `${MARKER}
## 🪰 Flytrap: ❌ Request Changes

Adds a zero check to \`div\` and changes \`add\`, which now subtracts.

### Findings (4)

3 are inline comments on the diff.

1 is outside the diff, so it is listed here:

- **Suggestion** · Testing · \`src/math.js:10\`: No test for the zero check
  Add a test that divides by zero.
`,
      comments: [
        {
          path: 'src/math.js',
          line: 2,
          side: 'RIGHT',
          body: `**Blocker** · Correctness: add() now subtracts

Use \`a + b\`.

\`\`\`suggestion
  return a + b;
\`\`\`
`,
        },
        {
          path: 'src/math.js',
          start_line: 21,
          start_side: 'RIGHT',
          line: 23,
          side: 'RIGHT',
          body: `**Nitpick** · Maintainability: Needless temporary

\`q\` is returned straight away.

\`\`\`suggestion
  if (b === 0) return 0;
  return a / b;
\`\`\`
`,
        },
        {
          path: 'docs/notes.md',
          line: 32,
          side: 'RIGHT',
          body: '**Nitpick** · Conventions: Vague line\n\nSay what the new line is for.\n',
        },
      ],
    },
  }]);
});

test('says so when there are no Findings', () => {
  const { actions } = planReview({ raw: fixture('findings-approve.json'), prNumber: 7, diff: fixture('pr.diff') });
  assert.equal(actions[0].body.body, `${MARKER}
## 🪰 Flytrap: ✅ Approve

A small, correct change.

No findings.
`);
  assert.deepEqual(actions[0].body.comments, []);
  assert.ok(!('commit_id' in actions[0].body));
});

test('breaks @mentions in model-written text, inline and in the summary', () => {
  const findings = [
    finding({ file: 'src/math.js', line: 2, title: 'ping @oak', body: 'hi @someone' }),
    finding({ file: 'src/other.js', line: 1, title: 'ping @oak', body: 'hi @someone' }),
  ];
  const { body } = plan(findings, { summary: 'cc @oak-wildwood/everyone' });
  assert.doesNotMatch(body.body, /@[A-Za-z]/);
  assert.match(body.body, /@​oak-wildwood\/everyone/);
  assert.doesNotMatch(body.comments[0].body, /@[A-Za-z]/);
});

for (const raw of [undefined, '', '   \n']) {
  test(`fails when structured_output is ${JSON.stringify(raw)}`, () => {
    assert.throws(() => planReview({ raw, prNumber: 7, diff: '' }), /no structured output/);
  });
}

test('fails on output that is not JSON', () => {
  assert.throws(() => planReview({ raw: 'Here is my review!', prNumber: 7, diff: '' }), /not JSON/);
});

test('fails on output that breaks the schema', () => {
  assert.throws(
    () => planReview({ raw: fixture('findings-bad-severity.json'), prNumber: 7, diff: '' }),
    (err) => /\$\.findings\[0\]\.category should be one of/.test(err.message)
      && /\$\.findings\[0\]\.severity should be one of/.test(err.message),
  );
});

test('fails without a PR number', () => {
  assert.throws(
    () => planReview({ raw: fixture('findings-approve.json'), prNumber: NaN, diff: '' }),
    /pull request number/,
  );
});

test('fails without a diff to place Findings against', () => {
  assert.throws(() => planReview({ raw: fixture('findings-approve.json'), prNumber: 7 }), /diff is required/);
});

test('posts exactly what it planned', async () => {
  const api = fakeApi();
  const plan = await postReview({
    raw: fixture('findings-request-changes.json'),
    prNumber: 7,
    diff: fixture('pr.diff'),
    commitId: SHA,
    api,
  });

  assert.equal(plan.actions[0].body.comments.length, 2);
  assert.deepEqual(api.calls, [['getEarlierReviews', 7], ['createReview', 7, plan.actions[0].body]]);
});

test('posts nothing when the output is invalid', async () => {
  const api = fakeApi();
  await assert.rejects(postReview({ raw: '', prNumber: 7, diff: fixture('pr.diff'), api }));
  assert.deepEqual(api.calls, []);
});

// --- The execution transcript: a denial fails the job before anything is posted (ADR 0003) ---

test('fails on a permission denial, naming the tool and its input', () => {
  assert.throws(
    () => planReview({ raw: fixture('findings-approve.json'), executionRaw: denialExecution(), prNumber: 7, diff: fixture('pr.diff') }),
    /denied permission to use Bash with input \{"command":"rm -rf \/"\}; the model was told: Claude requested permissions to use Bash/,
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
    () => planReview({ raw: fixture('findings-approve.json'), executionRaw, prNumber: 7, diff: fixture('pr.diff') }),
    (err) => {
      assert.match(err.message, /denied permission to use Write with input \{"file_path":"a\.js"/);
      assert.match(err.message, /… \(\d+ chars\); the model was told: Claude requested permissions to use Write\.$/);
      assert.ok(err.message.length < 500);
      return true;
    },
  );
});

test('checks for a denial even when there is no findings JSON at all', () => {
  assert.throws(
    () => planReview({ raw: '', executionRaw: denialExecution(), prNumber: 7, diff: fixture('pr.diff') }),
    /denied permission to use Bash/,
  );
});

test('a clean execution transcript does not affect a valid Review', () => {
  const plan = planReview({
    raw: fixture('findings-approve.json'),
    executionRaw: fixture('execution-clean.json'),
    prNumber: 7,
    diff: fixture('pr.diff'),
  });
  assert.equal(plan.actions.length, 1);
});

test('posts nothing on a permission denial, even with valid findings', async () => {
  const api = fakeApi();
  await assert.rejects(
    postReview({ raw: fixture('findings-approve.json'), executionRaw: denialExecution(), prNumber: 7, diff: fixture('pr.diff'), api }),
    /denied permission to use Bash/,
  );
  assert.deepEqual(api.calls, []);
});

test('checkRun checks the transcript before the Findings', () => {
  assert.throws(() => checkRun({ raw: '', executionRaw: denialExecution() }), /denied permission/);
  assert.equal(checkRun({ raw: fixture('findings-approve.json') }).verdict, 'approve');
});

// --- A 422 from GitHub on the inline comments falls back to a body-only review ---

test('posts every Finding in the body when GitHub rejects the inline comments', async () => {
  const api = fakeApi();
  const create = api.createReview;
  let attempts = 0;
  api.createReview = async (number, review) => {
    if (++attempts === 1) throw new Error('GitHub POST /pulls/7/reviews failed: 422 {"message":"Line could not be resolved"}');
    return create(number, review);
  };
  const warnings = [];
  const plan = await postReview({
    raw: fixture('findings-request-changes.json'),
    prNumber: 7,
    diff: fixture('pr.diff'),
    commitId: SHA,
    api,
    warn: (m) => warnings.push(m),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(plan.actions[0].body.comments, []);
  assert.match(plan.actions[0].body.body, /add\(\) now subtracts/);
  assert.deepEqual(api.calls, [['getEarlierReviews', 7], ['createReview', 7, plan.actions[0].body]]);
  assert.match(warnings[0], /GitHub rejected the inline comments/);
});

test('any other GitHub failure still fails the post', async () => {
  const api = fakeApi();
  api.createReview = async () => { throw new Error('GitHub POST /pulls/7/reviews failed: 500 oops'); };
  await assert.rejects(
    postReview({ raw: fixture('findings-request-changes.json'), prNumber: 7, diff: fixture('pr.diff'), commitId: SHA, api }),
    /500/,
  );
});

test('names the model that ran at the end of the Review, when known', () => {
  const args = { raw: fixture('findings-approve.json'), prNumber: 7, diff: fixture('pr.diff') };
  const named = planReview({ ...args, model: 'claude-sonnet-5-5' }).actions[0].body.body;
  assert.match(named, /<sub>Reviewed with `claude-sonnet-5-5`<\/sub>\n$/);
  assert.doesNotMatch(planReview(args).actions[0].body.body, /Reviewed with/);
});

// --- Re-runs: fingerprinted threads and earlier summaries ---
//
// test/fixtures/earlier-rerun.json is what an earlier run left on the PR: an open thread on
// `return a - b;` in src/math.js (a Correctness Finding), the summary it posted, an older summary
// already collapsed, and two reviews by other people, one of them quoting a Flytrap summary.

const SUBTRACTS = finding({ file: 'src/math.js', line: 2, severity: 'blocker', title: 'add() now subtracts', body: 'Use `a + b`.' });
const PI = finding({ file: 'src/math.js', line: 26, title: 'Use Math.PI' });

function rerun(findings, { diff = 'review.diff', earlier = jsonFixture('earlier-rerun.json') } = {}) {
  const raw = JSON.stringify({ verdict: 'request_changes', summary: 'A summary.', findings });
  return planReview({ raw, prNumber: 7, diff: fixture(diff), commitId: SHA, earlier }).actions;
}

const fingerprintOf = (comment) => comment.body.match(FINGERPRINT)[0];

test('each inline comment starts with a hidden fingerprint of its Finding', () => {
  const [a, b] = plan([SUBTRACTS, PI]).body.comments;
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
  // The same Finding in another run, even worded differently, gets the same fingerprint.
  const again = plan([{ ...SUBTRACTS, severity: 'suggestion', title: 'Subtracts', body: 'Other words.' }]).body.comments[0];
  assert.equal(fingerprintOf(again), fingerprintOf(a));
});

test('the fingerprint is stable, so threads from earlier releases still match', () => {
  const [comment] = plan([SUBTRACTS]).body.comments;
  assert.equal(fingerprintOf(comment), `${jsonFixture('earlier-rerun.json').threads[0].body.split('\n')[0]}\n`);
});

test('a Finding with an unresolved Flytrap thread is not posted again', () => {
  const [review] = rerun([SUBTRACTS, PI]);
  assert.equal(review.body.comments.length, 1);
  assert.equal(review.body.comments[0].line, 26);
  assert.match(review.body.body, /^### Findings \(2\)$/m);
  assert.match(review.body.body, /^1 already has an open thread from an earlier Review, so it is not posted again\.$/m);
});

test('a Finding whose Flytrap thread was resolved is posted again', () => {
  const earlier = jsonFixture('earlier-rerun.json');
  earlier.threads[0].isResolved = true;
  const [review] = rerun([SUBTRACTS], { earlier });
  assert.equal(review.body.comments.length, 1);
  assert.equal(review.body.comments[0].line, 2);
  assert.doesNotMatch(review.body.body, /open thread/);
});

test('a Finding whose line shifted still matches its thread', () => {
  // review-shifted.diff adds two lines above add() and re-indents its return, now on line 4.
  const [review] = rerun([{ ...SUBTRACTS, line: 4 }], { diff: 'review-shifted.diff' });
  assert.deepEqual(review.body.comments, []);
  assert.match(review.body.body, /^1 already has an open thread/m);
});

test('a Finding of another category on the same line is still posted', () => {
  const [review] = rerun([{ ...SUBTRACTS, category: 'testing' }]);
  assert.equal(review.body.comments.length, 1);
});

test('a thread someone else started cannot hide a Finding, even with a copied fingerprint', () => {
  const earlier = jsonFixture('earlier-rerun.json');
  earlier.threads[0].viewerDidAuthor = false;
  assert.equal(rerun([SUBTRACTS], { earlier })[0].body.comments.length, 1);
});

test('only a fingerprint at the very start of a thread counts', () => {
  const earlier = jsonFixture('earlier-rerun.json');
  earlier.threads[0].body = `Quoting the model:\n${earlier.threads[0].body}`;
  assert.equal(rerun([SUBTRACTS], { earlier })[0].body.comments.length, 1);
});

test('earlier Flytrap summaries are collapsed as outdated, and nothing else', () => {
  const [, ...collapses] = rerun([SUBTRACTS]);
  assert.deepEqual(collapses, [{ type: 'collapse', subjectId: 'PRR_second', classifier: 'OUTDATED' }]);
});

test('with no earlier Reviews there is nothing to collapse or skip', () => {
  const actions = rerun([SUBTRACTS], { earlier: { reviews: [], threads: [] } });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].body.comments.length, 1);
});

test('collapses earlier summaries only after the new Review is posted', async () => {
  const api = fakeApi({ earlier: jsonFixture('earlier-rerun.json') });
  const raw = JSON.stringify({ verdict: 'request_changes', summary: 'S.', findings: [SUBTRACTS] });
  const plan = await postReview({ raw, prNumber: 7, diff: fixture('review.diff'), commitId: SHA, api });
  assert.deepEqual(api.calls, [
    ['getEarlierReviews', 7],
    ['createReview', 7, plan.actions[0].body],
    ['minimize', 'PRR_second', 'OUTDATED'],
  ]);
  assert.deepEqual(plan.actions[0].body.comments, []);
});

test('a summary that will not collapse is a warning, not a failure', async () => {
  const api = fakeApi({ earlier: jsonFixture('earlier-rerun.json') });
  api.minimize = async () => { throw new Error('GitHub GraphQL failed: 403'); };
  const warnings = [];
  await postReview({ raw: fixture('findings-approve.json'), prNumber: 7, diff: fixture('pr.diff'), api, warn: (m) => warnings.push(m) });
  assert.equal(api.calls.filter(([name]) => name === 'createReview').length, 1);
  assert.match(warnings[0], /could not collapse an earlier Flytrap summary as outdated: GitHub GraphQL failed: 403/);
});

test('collapses nothing when the new Review fails to post', async () => {
  const api = fakeApi({ earlier: jsonFixture('earlier-rerun.json') });
  api.createReview = async () => { throw new Error('GitHub POST /pulls/7/reviews failed: 500 oops'); };
  await assert.rejects(postReview({ raw: fixture('findings-approve.json'), prNumber: 7, diff: fixture('pr.diff'), api }), /500/);
  assert.ok(!api.calls.some(([name]) => name === 'minimize'));
});
