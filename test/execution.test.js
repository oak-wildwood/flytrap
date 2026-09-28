import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDenial } from '../src/execution.js';
import { fixture } from './helpers.js';

// A transcript with one failed tool call and a final result message, shaped like the raw Agent
// SDK messages claude-code-action writes to its execution file.
function transcript({ tool = 'Read', input = { file_path: 'a.js' }, error, denials = [] }) {
  return JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: tool, input }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: error }] } },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: denials },
  ]);
}

test('finds the denied tool and its input', () => {
  const denial = findDenial(fixture('execution-denial.json'));

  assert.equal(denial.tool, 'Bash');
  assert.deepEqual(denial.input, { command: 'rm -rf /' });
  assert.match(denial.message, /haven't granted it yet/);
});

test('finds nothing in a clean transcript', () => {
  assert.equal(findDenial(fixture('execution-clean.json')), null);
});

for (const raw of [undefined, '', '   \n']) {
  test(`finds nothing when the transcript is ${JSON.stringify(raw)}`, () => {
    assert.equal(findDenial(raw), null);
  });
}

test('finds nothing when the transcript is not JSON', () => {
  assert.equal(findDenial('not json'), null);
});

test('finds nothing when the transcript is not an array', () => {
  assert.equal(findDenial(JSON.stringify({ oops: true })), null);
});

test('finds nothing when the run has no result message', () => {
  const raw = JSON.stringify([{ type: 'system', subtype: 'init' }]);
  assert.equal(findDenial(raw), null);
});

// Ordinary tool failures that mention permission. Only the SDK's own record counts as a denial.
for (const error of [
  "EACCES: permission denied, open 'secret.pem'",
  'rg: ./private: Permission denied (os error 13)',
  'File not found',
]) {
  test(`a tool error is not a denial: ${error}`, () => {
    assert.equal(findDenial(transcript({ error })), null);
  });
}

test('finds a denial of an allowed tool, such as a Read outside the checkout', () => {
  const error = "Claude requested permissions to read from /etc/passwd, but you haven't granted it yet.";
  const input = { file_path: '/etc/passwd' };
  const raw = transcript({ input, error, denials: [{ tool_name: 'Read', tool_use_id: 't1', tool_input: input }] });

  assert.deepEqual(findDenial(raw), { tool: 'Read', input, message: error });
});

test('finds a denial whatever its message says', () => {
  const raw = transcript({ tool: 'Write', error: 'Blocked.', denials: [{ tool_name: 'Write', tool_use_id: 't1', tool_input: {} }] });

  assert.equal(findDenial(raw).tool, 'Write');
});

test('reports a denial with no matching tool_result, with an empty message', () => {
  const raw = JSON.stringify([
    { type: 'result', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'gone', tool_input: { command: 'ls' } }] },
  ]);

  assert.deepEqual(findDenial(raw), { tool: 'Bash', input: { command: 'ls' }, message: '' });
});

test('reads tool_result content given as an array of blocks', () => {
  const raw = JSON.stringify([
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'Not granted.' }] },
        ],
      },
    },
    { type: 'result', permission_denials: [{ tool_name: 'Write', tool_use_id: 't1', tool_input: {} }] },
  ]);

  assert.equal(findDenial(raw).message, 'Not granted.');
});
