import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The eval workflow repeats action.yml's Adapter call, so the eval measures what real Reviews run.
// These fail if the two calls drift apart: in their claude_args, or in which inputs they pass.
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

// Only where --model comes from differs: a Review takes it from `prepare`, which may have read a
// `@flytrap use <name>` in the comment, and the eval from its own dispatch input, so a comment
// can't change what the eval measures. Everything else has to match.
const withoutModel = (args) => args.filter((line) => !line.startsWith('--model '));

test('the eval workflow calls the Adapter with the same claude_args as action.yml', () => {
  const eval_ = claudeArgs(read('.github/workflows/flytrap-eval.yml'));
  const action = claudeArgs(read('action.yml'));
  assert.ok(eval_.some((line) => line.startsWith('--tools ')), 'found the block');
  assert.deepEqual(withoutModel(eval_), withoutModel(action));
  assert.ok(eval_.includes('--model ${{ inputs.model }}'));
  assert.ok(action.includes('--model ${{ steps.prepare.outputs.model }}'));
});

// The keys under the claude-code-action step's `with:`.
function adapterInputs(yaml) {
  const lines = yaml.split('\n');
  const uses = lines.findIndex((line) => /uses: anthropics\/claude-code-action@/.test(line));
  assert.notEqual(uses, -1, 'no claude-code-action step');
  const withLine = lines.findIndex((line, i) => i > uses && /^\s*with:\s*$/.test(line));
  const indent = lines[withLine + 1].match(/^\s*/)[0];
  const keys = [];
  for (const line of lines.slice(withLine + 1)) {
    if (line.trim() && !line.startsWith(indent)) break;
    const key = line.startsWith(indent) && !line.startsWith(`${indent} `) && line.match(/^\s*([a-z_]+):/);
    if (key) keys.push(key[1]);
  }
  return keys.sort();
}

test('the eval workflow passes the same Adapter inputs as action.yml', () => {
  // The eval runs on this repo's own OAuth secret, so it has no API-key alternative to offer.
  const expected = adapterInputs(read('action.yml')).filter((key) => key !== 'anthropic_api_key');
  assert.deepEqual(adapterInputs(read('.github/workflows/flytrap-eval.yml')), expected);
  assert.ok(expected.includes('github_token'), 'without it claude-code-action wants an OIDC token');
});
