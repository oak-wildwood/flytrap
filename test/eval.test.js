import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listFixtures, loadFixture, buildEvalPrompt, prepareFixture, scoreFixture, renderReport, buildReport,
} from '../src/eval.js';
import { loadSkillText, schemaForHarness, HARNESS_TERMS } from '../src/prepare.js';

test('lists the fixture set', () => {
  assert.deepEqual(listFixtures(), ['clean', 'injection', 'missing-null-check', 'off-by-one']);
});

test('loads a fixture\'s diff and expected planted bugs', () => {
  const fixture = loadFixture('off-by-one');
  assert.match(fixture.diff, /for \(let i = start; i <= end; i\+\+\)/);
  assert.equal(fixture.expected.planted_bugs.length, 1);
  assert.equal(fixture.expected.planted_bugs[0].id, 'off-by-one-loop-bound');
});

test('the clean fixture has no planted bugs', () => {
  assert.deepEqual(loadFixture('clean').expected.planted_bugs, []);
});

test('builds a prompt with the Rubric and the diff, but no fixture name and no PR framing', () => {
  const fixture = loadFixture('injection');
  const prompt = buildEvalPrompt(fixture);

  assert.match(prompt, /# Flytrap Review/);
  assert.match(prompt, /This is a Rubric eval fixture, not a real pull request/);
  assert.ok(prompt.includes(HARNESS_TERMS), 'the eval runs under the same terms as a real Review');
  // The name would tell the model what to find. (The Rubric itself lists "off-by-one" and
  // "injection" as things to check for, the same as in real Reviews, so only the framing is checked.)
  const framing = prompt.slice(loadSkillText().length);
  for (const name of listFixtures()) assert.ok(!framing.includes(name), `the prompt must not name "${name}"`);
  assert.ok(prompt.includes(fixture.diff));
  assert.doesNotMatch(prompt, /Pull request:/);
  assert.doesNotMatch(prompt, /^---\nname:/, 'skill frontmatter is stripped');
});

test('fences the diff so backticks in it cannot close the fence', () => {
  const prompt = buildEvalPrompt({ name: 'x', diff: '+ const s = ````;\n' });
  assert.match(prompt, /^`````diff$/m);
});

test('prepares a fixture with the same schema a real Review with no Spec uses', () => {
  const { prompt, json_schema } = prepareFixture('clean');
  assert.match(prompt, /This is a Rubric eval fixture/);
  const schema = JSON.parse(json_schema);
  assert.deepEqual(schema, schemaForHarness(false));
  // A fixture closes no issue, so there's nothing to check a spec Finding against.
  assert.ok(!schema.properties.findings.items.properties.category.enum.includes('spec'));
});

test('fails clearly for an unknown fixture', () => {
  assert.throws(() => loadFixture('does-not-exist'), /ENOENT/);
});

function review(overrides = {}) {
  return JSON.stringify({ verdict: 'request_changes', summary: 's', findings: [], ...overrides });
}

test('scores a found planted bug when a Finding overlaps its line range', () => {
  const fixture = loadFixture('off-by-one');
  const finding = { file: 'src/paginate.js', line: 6, end_line: 7, category: 'correctness', severity: 'blocker', title: 'off by one', body: 'b' };
  const result = scoreFixture(fixture, review({ findings: [finding] }));

  assert.equal(result.found.length, 1);
  assert.equal(result.missed.length, 0);
  assert.equal(result.found[0].bug.id, 'off-by-one-loop-bound');
  assert.deepEqual(result.found[0].finding, finding);
});

test('scores a planted bug as missed when no Finding overlaps it', () => {
  const fixture = loadFixture('off-by-one');
  const other = { file: 'src/paginate.js', line: 1, category: 'maintainability', severity: 'nitpick', title: 'x', body: 'b' };
  const result = scoreFixture(fixture, review({ findings: [other] }));

  assert.equal(result.found.length, 0);
  assert.deepEqual(result.missed, fixture.expected.planted_bugs);
});

test('a Finding on the right lines but the wrong file does not count', () => {
  const fixture = loadFixture('off-by-one');
  const wrongFile = { file: 'src/other.js', line: 6, category: 'correctness', severity: 'blocker', title: 'x', body: 'b' };
  const result = scoreFixture(fixture, review({ findings: [wrongFile] }));

  assert.equal(result.found.length, 0);
  assert.equal(result.missed.length, 1);
});

test('reports the clean fixture\'s Verdict and Finding count', () => {
  const fixture = loadFixture('clean');
  const result = scoreFixture(fixture, review({ verdict: 'approve', findings: [] }));

  assert.deepEqual(result, { name: 'clean', found: [], missed: [], verdict: 'approve', findingCount: 0 });
});

test('records an error instead of throwing when the Harness produced nothing usable', () => {
  const fixture = loadFixture('injection');
  const result = scoreFixture(fixture, undefined);

  assert.equal(result.name, 'injection');
  assert.match(result.error, /no structured output/);
});

test('renders found and missed planted bugs per diff', () => {
  const results = [
    {
      name: 'off-by-one',
      found: [{ bug: { id: 'off-by-one-loop-bound' }, finding: { file: 'src/paginate.js', line: 6, title: 'off by one' } }],
      missed: [],
      verdict: 'request_changes',
      findingCount: 3,
    },
    {
      name: 'injection',
      found: [],
      missed: [{ id: 'shell-command-injection', description: 'unsanitized filename' }],
      verdict: 'approve',
      findingCount: 0,
    },
  ];

  assert.equal(renderReport(results), `# Flytrap Rubric eval report

## off-by-one

Found 1/1 planted bugs.

- ✅ **off-by-one-loop-bound** — found as \`src/paginate.js:6\` "off by one"

Verdict: **request_changes**, 3 finding(s).

## injection

Found 0/1 planted bugs.

- ❌ **shell-command-injection** — missed (unsanitized filename)

Verdict: **approve**, 0 finding(s).
`);
});

test('renders the clean fixture\'s Verdict and Finding count', () => {
  const results = [{ name: 'clean', found: [], missed: [], verdict: 'approve', findingCount: 0 }];
  assert.equal(renderReport(results), `# Flytrap Rubric eval report

## clean

Verdict: **approve**, 0 finding(s).
`);
});

test('renders an error for a fixture with no usable Review', () => {
  const results = [{ name: 'clean', error: 'the Harness returned no structured output' }];
  assert.equal(renderReport(results), `# Flytrap Rubric eval report

## clean

⚠️ No usable Review: the Harness returned no structured output
`);
});

test('builds the report end to end from a directory of raw Harness outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flytrap-eval-'));
  try {
    writeFileSync(join(dir, 'off-by-one.json'), review({
      findings: [{ file: 'src/paginate.js', line: 6, category: 'correctness', severity: 'blocker', title: 'off by one', body: 'b' }],
    }));
    writeFileSync(join(dir, 'clean.json'), review({ verdict: 'approve' }));
    // injection.json and missing-null-check.json are left absent, as if that step never ran.

    const report = buildReport(dir);
    assert.match(report, /## off-by-one\n\nFound 1\/1 planted bugs\./);
    assert.match(report, /## clean\n\nVerdict: \*\*approve\*\*, 0 finding\(s\)\./);
    assert.match(report, /## injection\n\n⚠️ No usable Review:/);
    assert.match(report, /## missing-null-check\n\n⚠️ No usable Review:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
