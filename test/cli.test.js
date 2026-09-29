import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// No other test loads bin/flytrap.js, so a syntax error there (a stray backtick inside the USAGE
// template literal shipped in v1.1.0) passes every other test and breaks every Review.
const cli = new URL('../bin/flytrap.js', import.meta.url).pathname;

test('the CLI loads and prints its usage for an unknown command', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /^Usage:/);
  assert.match(result.stderr, /@flytrap use <name>/);
});

test('post-review --plan reads earlier reviews and threads from --earlier', () => {
  const path = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
  const result = spawnSync(process.execPath, [
    cli, 'post-review', '--pr', '7', '--plan',
    '--findings', path('findings-mix.json'),
    '--diff', path('review.diff'),
    '--earlier', path('earlier-rerun.json'),
  ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  const { actions } = JSON.parse(result.stdout);
  // findings-mix.json's add() Finding already has the open thread in earlier-rerun.json.
  assert.equal(actions[0].body.comments.length, 2);
  assert.match(actions[0].body.body, /^1 already has an open thread/m);
  assert.deepEqual(actions.slice(1), [{ type: 'collapse', subjectId: 'PRR_second', classifier: 'OUTDATED' }]);
});
