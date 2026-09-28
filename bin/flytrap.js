#!/usr/bin/env node
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { githubApi } from '../src/github.js';
import { writeOutputs } from '../src/outputs.js';
import { parseMaxDiffSize, prepare } from '../src/prepare.js';
import { checkRun, planReview, postReview } from '../src/post-review.js';
import { swapReaction } from '../src/react.js';
import { buildReport, listFixtures, prepareFixture } from '../src/eval.js';

const USAGE = `Usage:
  flytrap prepare
      Reads the triggering event from $GITHUB_EVENT_PATH, checks the commenter may start a
      Review, and writes step outputs to $GITHUB_OUTPUT (stdout when unset).
  flytrap post-review --pr <number> [--findings <file>] [--execution <file>] [--diff <file>] [--commit <sha>] [--plan]
      Posts Findings JSON (from --findings, else $FLYTRAP_FINDINGS) as one PR review, with an
      inline comment for each Finding inside the diff, after checking the execution transcript
      (from --execution, else $FLYTRAP_EXECUTION_FILE) for a permission denial. --diff is the diff
      the Findings were made against (fetched when omitted) and --commit the head commit it was
      taken at. --plan prints what would be posted as JSON and makes no GitHub calls; it needs --diff.
  flytrap swap-reaction
      Swaps the 👀 reaction (from $FLYTRAP_REACTION_ID, $FLYTRAP_COMMENT_ID) for 🚀 or 😕
      depending on $FLYTRAP_OUTCOME. A no-op when $FLYTRAP_REACTION_ID is empty. Never fails
      the job: a failed swap is logged to the job summary instead.
  flytrap eval-list
      Prints the Rubric eval set's fixture names as a JSON array.
  flytrap eval-prepare --fixture <name>
      Writes one eval fixture's prompt and findings schema to $GITHUB_OUTPUT (stdout when unset).
  flytrap eval-report --dir <path>
      Reads each fixture's raw Harness output from <path>/<fixture>.json and prints the eval
      report (also appended to $GITHUB_STEP_SUMMARY when set).`;

const commands = {
  async prepare() {
    const event = JSON.parse(readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8'));
    let result;
    try {
      const excludes = (process.env.FLYTRAP_EXCLUDE ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const maxDiffSize = parseMaxDiffSize(process.env.FLYTRAP_MAX_DIFF_SIZE);
      result = await prepare({ event, api: apiFromEnv(), excludes, maxDiffSize });
    } catch (err) {
      // A failure after the 👀 went on still hands the swap step its ids (src/prepare.js).
      if (err.outputs) writeOutputs(err.outputs);
      throw err;
    }
    const outputs = { proceed: result.proceed, reason: result.reason, ...result.outputs };
    // A file rather than an output: step outputs are capped at 1 MB, and post-review needs the
    // exact diff the model reviewed, not whatever the PR shows once someone pushes again.
    if (result.proceed) {
      const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'flytrap-'));
      outputs.diff_path = join(dir, 'pr.diff');
      writeFileSync(outputs.diff_path, result.diff);
    }
    writeOutputs(outputs);
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
        diff: { type: 'string' },
        commit: { type: 'string' },
        plan: { type: 'boolean' },
      },
    });
    const prNumber = Number(values.pr);
    const raw = values.findings ? readFileSync(values.findings, 'utf8') : process.env.FLYTRAP_FINDINGS;
    const executionPath = values.execution ?? process.env.FLYTRAP_EXECUTION_FILE;
    const executionRaw = executionPath ? readFileSync(executionPath, 'utf8') : undefined;
    const commitId = values.commit || undefined;
    // Validate before touching GitHub config, so empty output or a denial reports itself as that.
    checkRun({ raw, executionRaw });
    if (values.plan) {
      if (!values.diff) throw new Error('--plan needs --diff, since it makes no GitHub calls');
      const plan = planReview({ raw, executionRaw, prNumber, diff: readFileSync(values.diff, 'utf8'), commitId });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    const api = apiFromEnv();
    const diff = values.diff ? readFileSync(values.diff, 'utf8') : await api.getDiff(prNumber);
    await postReview({ raw, executionRaw, prNumber, diff, commitId, api });
    console.error(`Posted the Review on #${prNumber}`);
  },

  async 'swap-reaction'() {
    const warn = (message) => {
      console.error(`::warning::${message}`);
      stepSummary(message);
    };
    // swapReaction skips an empty reaction id and catches its own API failures. This catch is
    // for a throw before it runs, e.g. from apiFromEnv(), so that can't reach the top-level catch
    // below and flip the job's own outcome (the thing it's trying to report in the first place).
    try {
      await swapReaction({
        commentId: Number(process.env.FLYTRAP_COMMENT_ID),
        reactionId: process.env.FLYTRAP_REACTION_ID ?? '',
        outcome: process.env.FLYTRAP_OUTCOME,
        api: apiFromEnv(),
        warn,
      });
    } catch (err) {
      warn(`could not swap the 👀 reaction for the outcome: ${err.message}`);
    }
  },

  async 'eval-list'() {
    console.log(JSON.stringify(listFixtures()));
  },

  async 'eval-prepare'(argv) {
    const { values } = parseArgs({ args: argv, options: { fixture: { type: 'string' } } });
    if (!values.fixture) throw new Error('--fixture <name> is required');
    writeOutputs(prepareFixture(values.fixture));
  },

  async 'eval-report'(argv) {
    const { values } = parseArgs({ args: argv, options: { dir: { type: 'string' } } });
    if (!values.dir) throw new Error('--dir <path> is required');
    const report = buildReport(values.dir);
    console.log(report);
    stepSummary(report);
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
