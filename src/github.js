// The handful of GitHub REST calls Flytrap makes. Commands take this as a parameter so tests
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
    return accept.endsWith('diff') ? res.text() : res.json();
  }

  return {
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
    // Returns the reaction; GitHub answers 200 with the existing one if it's already there.
    addReaction(commentId, content) {
      return request('POST', `/issues/comments/${commentId}/reactions`, { body: { content } });
    },
    createComment(number, body) {
      return request('POST', `/issues/${number}/comments`, { body: { body } });
    },
  };
}
