#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { githubApi } from '../src/github.js';
import { writeOutputs } from '../src/outputs.js';
import { prepare } from '../src/prepare.js';
import { planReview, postReview } from '../src/post-review.js';

const USAGE = `Usage:
  flytrap prepare
      Reads the triggering event from $GITHUB_EVENT_PATH, checks the commenter may start a
      Review, and writes step outputs to $GITHUB_OUTPUT (stdout when unset).
  flytrap post-review --pr <number> [--findings <file>] [--plan]
      Posts Findings JSON (from --findings, else $FLYTRAP_FINDINGS) as one PR comment.
      --plan prints what would be posted as JSON and makes no GitHub calls.`;

const commands = {
  async prepare() {
    const event = JSON.parse(readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8'));
    const result = await prepare({ event, api: apiFromEnv() });
    writeOutputs({ proceed: result.proceed, reason: result.reason, ...result.outputs });
    const line = `${result.proceed ? 'Reviewing' : 'Not reviewing'}: ${result.reason}`;
    console.error(line);
    stepSummary(line);
  },

  async 'post-review'(argv) {
    const { values } = parseArgs({
      args: argv,
      options: { pr: { type: 'string' }, findings: { type: 'string' }, plan: { type: 'boolean' } },
    });
    const prNumber = Number(values.pr);
    const raw = values.findings ? readFileSync(values.findings, 'utf8') : process.env.FLYTRAP_FINDINGS;
    // Validate before touching GitHub config, so empty output reports itself as that.
    const plan = planReview({ raw, prNumber });
    if (values.plan) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    await postReview({ raw, prNumber, api: apiFromEnv() });
    console.error(`Posted the Review on #${prNumber}`);
  },
};

function apiFromEnv() {
  return githubApi({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    baseUrl: process.env.GITHUB_API_URL,
  });
}

// So a stop or failure explains itself on the run page, without downloading anything.
function stepSummary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const [name, ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(USAGE);
  process.exit(2);
}
try {
  await command(rest);
} catch (err) {
  const message = `flytrap ${name} failed: ${err.message}`;
  console.error(`::error::${message.replace(/\n/g, '%0A')}`);
  stepSummary(message);
  process.exit(1);
}
