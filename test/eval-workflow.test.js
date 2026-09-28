import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The eval workflow repeats action.yml's Adapter call, so the eval measures what real Reviews run.
// This fails if the two calls' claude_args drift apart.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The lines of the `claude_args: |` block scalar, without their indentation.
function claudeArgs(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => /^\s*claude_args: \|\s*$/.test(line));
  assert.notEqual(start, -1, 'no claude_args block');
  const indent = lines[start + 1].match(/^\s*/)[0];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(indent)) break;
    block.push(line.slice(indent.length));
  }
  return block;
}

test('the eval workflow calls the Adapter with the same claude_args as action.yml', () => {
  const eval_ = claudeArgs(read('.github/workflows/flytrap-eval.yml'));
  assert.ok(eval_.some((line) => line.startsWith('--tools ')), 'found the block');
  assert.deepEqual(eval_, claudeArgs(read('action.yml')));
});
