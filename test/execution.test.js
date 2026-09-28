import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDenial } from '../src/execution.js';
import { fixture } from './helpers.js';

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

test('ignores a tool_result error that is not a permission denial', () => {
  const raw = JSON.stringify([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'missing.js' } }] },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'File not found' }] },
    },
  ]);

  assert.equal(findDenial(raw), null);
});

test('ignores an EACCES error from an allowed tool', () => {
  const raw = JSON.stringify([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'secret.pem' } }] },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true, content: "EACCES: permission denied, open 'secret.pem'" },
        ],
      },
    },
  ]);

  assert.equal(findDenial(raw), null);
});

test('reports the denial even without a matching tool_use', () => {
  const raw = JSON.stringify([
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'unknown', is_error: true, content: 'Permission denied.' },
        ],
      },
    },
  ]);

  assert.deepEqual(findDenial(raw), { tool: 'unknown', input: null, message: 'Permission denied.' });
});

test('reads tool_result content given as an array of blocks', () => {
  const raw = JSON.stringify([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.js' } }] },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            is_error: true,
            content: [{ type: 'text', text: 'Claude requested permissions to use Write, but you haven\'t granted it yet.' }],
          },
        ],
      },
    },
  ]);

  const denial = findDenial(raw);
  assert.equal(denial.tool, 'Write');
  assert.match(denial.message, /haven't granted it yet/);
});
