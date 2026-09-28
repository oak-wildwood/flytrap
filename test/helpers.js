import { readFileSync } from 'node:fs';

export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function jsonFixture(name) {
  return JSON.parse(fixture(name));
}

// A stand-in for src/github.js that answers from fixtures and records every call.
export function fakeApi({ permission, roleName = permission, pull = 'pull-same-repo.json', diff = 'pr.diff', gitattributes = null, issues = {} } = {}) {
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
    async getIssue(number) {
      calls.push(['getIssue', number]);
      const issue = issues[number];
      if (!issue) throw new Error(`no fixture issue #${number}`);
      return issue;
    },
    async getFileText(path, ref) {
      calls.push(['getFileText', path, ref]);
      return path === '.gitattributes' ? gitattributes : null;
    },
    async addReaction(commentId, content) {
      calls.push(['addReaction', commentId, content]);
      return { id: 42, content };
    },
    async deleteReaction(commentId, reactionId) {
      calls.push(['deleteReaction', commentId, reactionId]);
      return null;
    },
    async createComment(number, body) {
      calls.push(['createComment', number, body]);
      return { id: 1 };
    },
    async createReview(number, review) {
      calls.push(['createReview', number, review]);
      return { id: 1 };
    },
  };
}
