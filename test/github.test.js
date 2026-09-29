import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubApi } from '../src/github.js';

// A fetch that answers GraphQL queries from `pages`, one per call, and records what was asked.
function fakeFetch(pages) {
  const calls = [];
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ url, query, variables });
    const data = pages.shift();
    return { ok: true, status: 200, json: async () => data };
  };
  return { fetch, calls };
}

const page = (connection, nodes, endCursor = null) => ({
  data: { repository: { pullRequest: { [connection]: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } } } },
});

test('reads every earlier review and thread, a page at a time', async () => {
  const review = (id) => ({ id, body: '<!-- flytrap:review -->', isMinimized: false, viewerDidAuthor: true });
  const { fetch, calls } = fakeFetch([
    page('reviews', [review('R1')], 'c1'),
    page('reviews', [review('R2')]),
    page('reviewThreads', [
      { isResolved: true, comments: { nodes: [{ body: 'first', viewerDidAuthor: true }] } },
      { isResolved: false, comments: { nodes: [] } },
    ]),
  ]);
  const api = githubApi({ token: 't', repository: 'oak/flytrap', fetch });
  assert.deepEqual(await api.getEarlierReviews(7), {
    reviews: [review('R1'), review('R2')],
    threads: [{ isResolved: true, body: 'first', viewerDidAuthor: true }],
  });
  assert.equal(calls[0].url, 'https://api.github.com/graphql');
  assert.deepEqual(calls.map((c) => c.variables), [
    { owner: 'oak', name: 'flytrap', number: 7, after: null },
    { owner: 'oak', name: 'flytrap', number: 7, after: 'c1' },
    { owner: 'oak', name: 'flytrap', number: 7, after: null },
  ]);
});

test('collapses through minimizeComment, at the GitHub Enterprise Server GraphQL URL', async () => {
  const { fetch, calls } = fakeFetch([{ data: { minimizeComment: { clientMutationId: null } } }]);
  const api = githubApi({ token: 't', repository: 'oak/flytrap', fetch, baseUrl: 'https://ghe.example.com/api/v3' });
  await api.minimize('PRR_1', 'OUTDATED');
  assert.equal(calls[0].url, 'https://ghe.example.com/api/graphql');
  assert.match(calls[0].query, /minimizeComment/);
  assert.deepEqual(calls[0].variables, { subjectId: 'PRR_1', classifier: 'OUTDATED' });
});

test('a GraphQL error fails the call with its message', async () => {
  const { fetch } = fakeFetch([{ data: null, errors: [{ message: 'Resource not accessible by integration' }] }]);
  const api = githubApi({ token: 't', repository: 'oak/flytrap', fetch });
  await assert.rejects(api.minimize('PRR_1', 'OUTDATED'), /GitHub GraphQL failed: Resource not accessible by integration/);
});
