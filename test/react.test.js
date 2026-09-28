import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapReaction } from '../src/react.js';
import { fakeApi } from './helpers.js';

test('swaps 👀 for 🚀 on success', async () => {
  const api = fakeApi();
  await swapReaction({ commentId: 1001, reactionId: '42', outcome: 'success', api });

  assert.deepEqual(api.calls, [
    ['addReaction', 1001, 'rocket'],
    ['deleteReaction', 1001, '42'],
  ]);
});

for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
  test(`swaps 👀 for 😕 on ${outcome}`, async () => {
    const api = fakeApi();
    await swapReaction({ commentId: 1001, reactionId: '42', outcome, api });

    assert.deepEqual(api.calls, [
      ['addReaction', 1001, 'confused'],
      ['deleteReaction', 1001, '42'],
    ]);
  });
}

test('does nothing when no 👀 went on', async () => {
  const api = fakeApi();
  await swapReaction({ commentId: 1001, reactionId: '', outcome: 'success', api });

  assert.deepEqual(api.calls, []);
});

test('logs a failed swap instead of throwing', async () => {
  const api = fakeApi();
  api.deleteReaction = async () => { throw new Error('GitHub DELETE failed: 404'); };
  const warnings = [];

  await swapReaction({ commentId: 1001, reactionId: '42', outcome: 'success', api, warn: (m) => warnings.push(m) });

  assert.deepEqual(warnings, ['could not swap the 👀 reaction for the outcome: GitHub DELETE failed: 404']);
});
