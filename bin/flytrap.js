#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { githubApi } from '../src/github.js';
import { writeOutputs } from '../src/outputs.js';
import { prepare } from '../src/prepare.js';
import { planReview, postReview } from '../src/post-review.js';
import { swapReaction } from '../src/react.js';

const USAGE = `Usage:
  flytrap prepare
      Reads the triggering event from $GITHUB_EVENT_PATH, checks the commenter may start a
      Review, and writes step outputs to $GITHUB_OUTPUT (stdout when unset).
  flytrap post-review --pr <number> [--findings <file>] [--execution <file>] [--plan]
      Posts Findings JSON (from --findings, else $FLYTRAP_FINDINGS) as one PR comment, after
      checking the execution transcript (from --execution, else $FLYTRAP_EXECUTION_FILE) for a
      permission denial. --plan prints what would be posted as JSON and makes no GitHub calls.
  flytrap swap-reaction
      Swaps the 👀 reaction (from $FLYTRAP_REACTION_ID, $FLYTRAP_COMMENT_ID) for 🚀 or 😕
      depending on $FLYTRAP_OUTCOME. A no-op when $FLYTRAP_REACTION_ID is empty. Never fails
      the job: a failed swap is logged to the job summary instead.`;

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
      options: {
        pr: { type: 'string' },
        findings: { type: 'string' },
        execution: { type: 'string' },
        plan: { type: 'boolean' },
      },
    });
    const prNumber = Number(values.pr);
    const raw = values.findings ? readFileSync(values.findings, 'utf8') : process.env.FLYTRAP_FINDINGS;
    const executionPath = values.execution ?? process.env.FLYTRAP_EXECUTION_FILE;
    const executionRaw = executionPath ? readFileSync(executionPath, 'utf8') : undefined;
    // Validate before touching GitHub config, so empty output or a denial reports itself as that.
    const plan = planReview({ raw, executionRaw, prNumber });
    if (values.plan) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    await postReview({ raw, executionRaw, prNumber, api: apiFromEnv() });
    console.error(`Posted the Review on #${prNumber}`);
  },

  async 'swap-reaction'() {
    const reactionId = process.env.FLYTRAP_REACTION_ID ?? '';
    if (!reactionId) return;
    const warn = (message) => {
      console.error(`::warning::${message}`);
      stepSummary(message);
    };
    // Never lets a swap failure reach the top-level catch below and flip the job's own outcome
    // (the thing it's trying to report in the first place).
    try {
      await swapReaction({
        commentId: Number(process.env.FLYTRAP_COMMENT_ID),
        reactionId,
        outcome: process.env.FLYTRAP_OUTCOME,
        api: apiFromEnv(),
        warn,
      });
    } catch (err) {
      warn(`could not swap the 👀 reaction for the outcome: ${err.message}`);
    }
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
