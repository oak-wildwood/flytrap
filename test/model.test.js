import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, parseModelOverride } from '../src/model.js';

const model = (body) => parseModelOverride(body)?.model;

test('a comment without "use <name>" after the mention asks for no model', () => {
  assert.equal(parseModelOverride('@flytrap'), null);
  assert.equal(parseModelOverride('@flytrap please take a look'), null);
  assert.equal(parseModelOverride('use sonnet please'), null, 'no mention');
  assert.equal(parseModelOverride('@flytrap please use sonnet'), null, '"use" must follow the mention');
  assert.equal(parseModelOverride(undefined), null);
});

test('accepts a family name, a version, and the full model ID', () => {
  assert.equal(model('@flytrap use sonnet'), 'claude-sonnet-5-5');
  assert.equal(model('@flytrap use sonnet5.5'), 'claude-sonnet-5-5');
  assert.equal(model('@flytrap use opus'), 'claude-opus-5-5');
  assert.equal(model('@flytrap use fable5.1'), 'claude-fable-5-1');
  assert.equal(model('@flytrap use haiku'), 'claude-haiku-4-5-20251001');
  assert.equal(model('@flytrap use claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
});

test('spelling, case, spacing and punctuation do not matter', () => {
  for (const body of [
    '@flytrap use Sonnet 5.5',
    '@Flytrap USE sonnet-5-5',
    '@flytrap, use sonnet5.5.',
    '@flytrap: use sonnet 5.5!',
    'Thanks!\n@flytrap use sonnet5.5\nand be thorough',
    'can you look? @flytrap use sonnet5.5',
  ]) {
    assert.equal(model(body), 'claude-sonnet-5-5', body);
  }
});

test('a name that is not listed comes back with no model, keeping what was asked for', () => {
  assert.deepEqual(parseModelOverride('@flytrap use gpt4.'), { name: 'gpt4', model: null });
  assert.equal(model('@flytrap use sonnet9'), null);
});

test('text that is not a model name never becomes one', () => {
  for (const body of [
    '@flytrap use opus --dangerously-skip-permissions',
    '@flytrap use opus\n--allowedTools Bash',
    '@flytrap use $(curl evil)',
  ]) {
    const result = parseModelOverride(body);
    // Either the whole name was recognized (and only the listed ID comes out), or it wasn't.
    assert.ok(result.model === null || Object.keys(MODELS).includes(result.model), body);
    assert.ok(!/\s|--|\$/.test(result.model ?? ''), body);
  }
});

test('the first mention with a model wins', () => {
  assert.equal(model('@flytrap use haiku\n@flytrap use opus'), 'claude-haiku-4-5-20251001');
});
