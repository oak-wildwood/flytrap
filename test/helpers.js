import { readFileSync } from 'node:fs';

export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function jsonFixture(name) {
  return JSON.parse(fixture(name));
}

// A stand-in for src/github.js that answers from fixtures and records every call.
export function fakeApi({ permission, roleName = permission, pull = 'pull-same-repo.json', diff = 'pr.diff' } = {}) {
  const calls = [];
  return {
    calls,
    async getPermission(username) {
      calls.push(['getPermission', username]);
      return { permission, roleName };
    },
    async getPull(number) {
      calls.push(['getPull', number]);
      return jsonFixture(pull);
    },
    async getDiff(number) {
      calls.push(['getDiff', number]);
      return fixture(diff);
    },
    async addReaction(commentId, content) {
      calls.push(['addReaction', commentId, content]);
      return { id: 42, content };
    },
    async createComment(number, body) {
      calls.push(['createComment', number, body]);
      return { id: 1 };
    },
  };
}
