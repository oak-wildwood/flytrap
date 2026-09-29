// The handful of GitHub REST and GraphQL calls Flytrap makes. Commands take this as a parameter so tests
// can pass a fake in its place.
export function githubApi({ token, repository, fetch = globalThis.fetch, baseUrl = 'https://api.github.com' }) {
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');

  async function request(method, path, { body, accept = 'application/vnd.github+json' } = {}) {
    const res = await fetch(`${baseUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'flytrap',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return null; // DELETE endpoints answer with no body.
    return accept.endsWith('diff') || accept.endsWith('raw') ? res.text() : res.json();
  }

  // GitHub Enterprise Server serves GraphQL at /api/graphql next to the REST API's /api/v3.
  const graphqlUrl = baseUrl.replace(/\/api\/v3\/?$/, '/api') + '/graphql';
  const [owner, name] = repository.split('/');

  async function graphql(query, variables) {
    const res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'flytrap',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status} ${await res.text()}`);
    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(`GitHub GraphQL failed: ${errors.map((e) => e.message).join('; ')}`);
    return data;
  }

  // Every node of one pull request connection, a page at a time.
  async function all(connection, fields, number) {
    const nodes = [];
    let after = null;
    do {
      const data = await graphql(
        `query($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              ${connection}(first: 100, after: $after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }
            }
          }
        }`,
        { owner, name, number, after },
      );
      const page = data.repository.pullRequest[connection];
      nodes.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    return nodes;
  }

  return {
    // What earlier runs left on a pull request, in the shape src/post-review.js reads: every
    // review, and every review thread by its first comment. Resolution and collapsing are
    // GraphQL-only.
    async getEarlierReviews(number) {
      const reviews = await all('reviews', 'id body isMinimized viewerDidAuthor', number);
      const threads = await all('reviewThreads', 'isResolved comments(first: 1) { nodes { body viewerDidAuthor } }', number);
      return {
        reviews,
        threads: threads
          .filter((t) => t.comments.nodes.length)
          .map((t) => ({ isResolved: t.isResolved, ...t.comments.nodes[0] })),
      };
    },
    // Collapses a review (or comment) by its node id, e.g. as OUTDATED.
    async minimize(subjectId, classifier) {
      await graphql(
        'mutation($subjectId: ID!, $classifier: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $subjectId, classifier: $classifier }) { clientMutationId } }',
        { subjectId, classifier },
      );
    },
    // `permission` folds maintain into write and triage into read; `role_name` keeps them apart.
    async getPermission(username) {
      const data = await request('GET', `/collaborators/${encodeURIComponent(username)}/permission`);
      return { permission: data.permission, roleName: data.role_name };
    },
    getPull(number) {
      return request('GET', `/pulls/${number}`);
    },
    getDiff(number) {
      return request('GET', `/pulls/${number}`, { accept: 'application/vnd.github.diff' });
    },
    // A file's text at a commit, or null when it doesn't exist there.
    async getFileText(path, ref) {
      try {
        return await request('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {
          accept: 'application/vnd.github.raw',
        });
      } catch (err) {
        if (/ failed: 404\b/.test(err.message)) return null;
        throw err;
      }
    },
    // For the Spec: the title and body of an issue this pull request closes.
    getIssue(number) {
      return request('GET', `/issues/${number}`);
    },
    // Returns the reaction; GitHub answers 200 with the existing one if it's already there.
    addReaction(commentId, content) {
      return request('POST', `/issues/comments/${commentId}/reactions`, { body: { content } });
    },
    deleteReaction(commentId, reactionId) {
      return request('DELETE', `/issues/comments/${commentId}/reactions/${reactionId}`);
    },
    // Only for the "too large to review" notice; Reviews go through createReview.
    createComment(number, body) {
      return request('POST', `/issues/${number}/comments`, { body: { body } });
    },
    // `review` is { commit_id?, event, body, comments: [{ path, line, side, start_line?, ... }] }.
    createReview(number, review) {
      return request('POST', `/pulls/${number}/reviews`, { body: review });
    },
  };
}
