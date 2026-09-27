import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { formatOutputs } from '../src/outputs.js';
import { jsonFixture } from './helpers.js';

test('accepts the valid fixtures', () => {
  assert.deepEqual(validate(jsonFixture('findings-request-changes.json')), []);
  assert.deepEqual(validate(jsonFixture('findings-approve.json')), []);
});

test('rejects missing fields, extra fields, and wrong types', () => {
  assert.deepEqual(validate({ verdict: 'Approve', findings: [], extra: 1 }), [
    '$.summary is required',
    '$.extra is not allowed',
  ]);
  assert.deepEqual(validate([]), ['$ should be object']);
  const finding = { path: 'a', line: 0, category: 'Testing', severity: 'Nitpick', title: 't', body: '' };
  assert.deepEqual(validate({ verdict: 'Approve', summary: 's', findings: [finding] }), [
    '$.findings[0].line should be at least 1',
    '$.findings[0].body should not be empty',
  ]);
  assert.deepEqual(validate({ verdict: 'Approve', summary: 's', findings: [{ ...finding, line: 1.5, body: 'b' }] }), [
    '$.findings[0].line should be integer',
  ]);
});

test('refuses schema keywords it does not implement', () => {
  assert.throws(() => validate('x', { type: 'string', pattern: '^x$' }), /"pattern" .* not supported/);
});

test('step outputs use a delimiter the value cannot forge', () => {
  const text = formatOutputs({ proceed: true, prompt: 'line\nEOF\nproceed=false' });
  // Parse it the way the runner does.
  const lines = text.split('\n');
  const outputs = {};
  while (lines.length > 1) {
    const [name, delimiter] = lines.shift().split('<<');
    assert.match(delimiter, /^NUTHATCH_[0-9a-f]{32}$/);
    const end = lines.indexOf(delimiter);
    outputs[name] = lines.splice(0, end + 1).slice(0, -1).join('\n');
  }
  assert.deepEqual(outputs, { proceed: 'true', prompt: 'line\nEOF\nproceed=false' });
});
