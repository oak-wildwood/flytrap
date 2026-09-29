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
