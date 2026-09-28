import { validate } from './schema.js';
import { parseDiff, findHunk } from './diff.js';
import { findDenial } from './execution.js';
import { bySeverity, renderInline, renderSummary } from './render.js';

// Parses and checks the Harness's Findings JSON. Throws, failing the job, when there is nothing
// to post: a Review that produced no JSON must not look like a pass (ADR 0003).
export function parseFindings(raw) {
  if (!raw || !raw.trim()) {
    // claude-code-action can also skip itself (a workflow that doesn't match the default
    // branch's copy) and still report success; that lands here too.
    throw new Error(
      'the Harness returned no structured output, so there is no Review to post. ' +
      'It may have given up, hit a permission denial, or skipped itself',
    );
  }
  let review;
  try {
    review = JSON.parse(raw);
  } catch (err) {
    throw new Error(`the Harness's structured output is not JSON: ${err.message}`);
  }
  const errors = validate(review);
  if (errors.length) {
    throw new Error(`the Harness's structured output does not match the findings schema:\n  ${errors.join('\n  ')}`);
  }
  return review;
}

// What post-review checks before anything else, and before touching GitHub config: the execution
// transcript first, then the Findings. A denial fails the job on its own even when the Findings
// happen to be well-formed: a denial partway through a run must not pass silently just because
// the model produced something that looks like a finished Review (ADR 0003).
export function checkRun({ raw, executionRaw }) {
  const denial = findDenial(executionRaw);
  if (denial) {
    throw new Error(
      `the Harness's execution denied permission to use ${denial.tool} with input ${truncate(JSON.stringify(denial.input))}` +
        (denial.message ? `; the model was told: ${truncate(denial.message)}` : ''),
    );
  }
  return parseFindings(raw);
}

// Works out what would be posted: one review with the COMMENT event, never APPROVE or
// REQUEST_CHANGES, so a bot can neither unblock nor block a merge. Plan mode stops here; tests
// assert on this.
//
// `diff` must be the diff the Findings were made against, and `commitId` the head commit it was
// taken at, so GitHub places the inline comments on the lines the model saw.
/**
 * @param {{ raw: string|undefined, executionRaw?: string, prNumber: number, diff: string, commitId?: string, allowInline?: boolean }} args
 */
export function planReview({ raw, executionRaw, prNumber, diff, commitId, allowInline = true }) {
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('a pull request number is required');
  const review = checkRun({ raw, executionRaw });
  if (typeof diff !== 'string') throw new Error('the pull request diff is required to place Findings');

  const hunks = parseDiff(diff);
  const inline = [];
  const outside = [];
  const comments = [];
  for (const f of bySeverity(review.findings)) {
    const end = Math.max(f.line, f.end_line ?? f.line);
    if (!allowInline || !findHunk(hunks, f.file, f.line, end)) {
      outside.push(f);
      continue;
    }
    inline.push(f);
    comments.push({
      path: f.file,
      ...(end > f.line ? { start_line: f.line, start_side: 'RIGHT' } : {}),
      line: end,
      side: 'RIGHT',
      body: renderInline(f),
    });
  }

  return {
    actions: [
      {
        type: 'review',
        method: 'POST',
        path: `/pulls/${prNumber}/reviews`,
        body: {
          ...(commitId ? { commit_id: commitId } : {}),
          event: 'COMMENT',
          body: renderSummary(review, { inline, outside }),
          comments,
        },
      },
    ],
  };
}

export async function postReview({ raw, executionRaw, prNumber, diff, commitId, api, warn = (message) => console.error(`::warning::${message}`) }) {
  const plan = planReview({ raw, executionRaw, prNumber, diff, commitId });
  try {
    for (const action of plan.actions) await api.createReview(prNumber, action.body);
    return plan;
  } catch (err) {
    // GitHub answers 422 when an inline comment doesn't land on the diff it knows (a push it
    // raced, a path it spells differently). Rather than lose the Review, post it again with every
    // Finding in the body. Anything else is a real failure.
    if (!/ failed: 422\b/.test(err.message) || !plan.actions[0]?.body.comments?.length) throw err;
    warn(`GitHub rejected the inline comments, so every Finding is in the review body instead: ${err.message}`);
    const fallback = planReview({ raw, executionRaw, prNumber, diff, commitId, allowInline: false });
    for (const action of fallback.actions) await api.createReview(prNumber, action.body);
    return fallback;
  }
}

// A denied Write or Edit carries a whole file as its input; keep the failure reason readable.
const MAX_INPUT_CHARS = 300;
function truncate(text = 'null') {
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}… (${text.length} chars)` : text;
}
