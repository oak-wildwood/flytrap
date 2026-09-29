import { createHash } from 'node:crypto';
import { validate } from './schema.js';
import { parseDiff, findHunk, newLines } from './diff.js';
import { findDenial } from './execution.js';
import { MARKER, bySeverity, readFingerprint, renderInline, renderSummary } from './render.js';

/**
 * What earlier runs left on the pull request, as src/github.js reads it. `viewerDidAuthor` is
 * true for what this token posted, so a comment someone else wrote can't pass itself off as
 * Flytrap's and hide a Finding. A thread's `body` is its first comment's.
 * @typedef {{
 *   reviews: { id: string, body: string, isMinimized: boolean, viewerDidAuthor: boolean }[],
 *   threads: { isResolved: boolean, body: string, viewerDidAuthor: boolean }[],
 * }} Earlier
 */
const NOTHING_EARLIER = { reviews: [], threads: [] };

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
// REQUEST_CHANGES, so a bot can neither unblock nor block a merge, then the earlier Flytrap
// summaries to collapse as outdated. Plan mode stops here; tests assert on this.
//
// `diff` must be the diff the Findings were made against, and `commitId` the head commit it was
// taken at, so GitHub places the inline comments on the lines the model saw. `earlier` is what
// earlier runs left on the pull request: an inline Finding that already has an unresolved thread
// there is not posted again, while one whose thread was resolved is, since the problem is still
// there.
/**
 * @param {{ raw: string|undefined, executionRaw?: string, prNumber: number, diff: string, commitId?: string, model?: string, earlier?: Earlier, allowInline?: boolean }} args
 */
export function planReview({ raw, executionRaw, prNumber, diff, commitId, model, earlier = NOTHING_EARLIER, allowInline = true }) {
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('a pull request number is required');
  const review = checkRun({ raw, executionRaw });
  if (typeof diff !== 'string') throw new Error('the pull request diff is required to place Findings');

  const hunks = parseDiff(diff);
  const texts = newLines(diff);
  const openThreads = new Set(
    earlier.threads
      .filter((t) => t.viewerDidAuthor && !t.isResolved)
      .map((t) => readFingerprint(t.body))
      .filter(Boolean),
  );
  const inline = [];
  const outside = [];
  const open = [];
  const comments = [];
  for (const f of bySeverity(review.findings)) {
    const end = Math.max(f.line, f.end_line ?? f.line);
    if (!allowInline || !findHunk(hunks, f.file, f.line, end)) {
      outside.push(f);
      continue;
    }
    const print = fingerprint(f, end, texts.get(f.file));
    if (openThreads.has(print)) {
      open.push(f);
      continue;
    }
    inline.push(f);
    comments.push({
      path: f.file,
      ...(end > f.line ? { start_line: f.line, start_side: 'RIGHT' } : {}),
      line: end,
      side: 'RIGHT',
      body: renderInline(f, print),
    });
  }

  const outdated = earlier.reviews.filter((r) => r.viewerDidAuthor && !r.isMinimized && r.body.startsWith(MARKER));
  return {
    actions: [
      {
        type: 'review',
        method: 'POST',
        path: `/pulls/${prNumber}/reviews`,
        body: {
          ...(commitId ? { commit_id: commitId } : {}),
          event: 'COMMENT',
          body: renderSummary(review, { inline, outside, open }, { model }),
          comments,
        },
      },
      ...outdated.map((r) => ({ type: 'collapse', subjectId: r.id, classifier: 'OUTDATED' })),
    ],
  };
}

// Which problem a Finding is about, computed here and never by the model: the file, the Rubric
// category, and the code on the commented lines. Line numbers are left out, so the fingerprint
// survives lines added or removed above it; whitespace is squeezed, so it survives re-indenting.
function fingerprint(f, end, lines) {
  const code = [];
  for (let n = f.line; n <= end; n++) code.push((lines?.get(n) ?? '').replace(/\s+/g, ' ').trim());
  return createHash('sha256').update(JSON.stringify([f.file, f.category, code])).digest('hex').slice(0, 16);
}

export async function postReview({ raw, executionRaw, prNumber, diff, commitId, model, api, warn = (message) => console.error(`::warning::${message}`) }) {
  // Before any GitHub call, so output that can't be posted reads nothing either.
  checkRun({ raw, executionRaw });
  const earlier = await api.getEarlierReviews(prNumber);
  let plan = planReview({ raw, executionRaw, prNumber, diff, commitId, model, earlier });
  const [first, ...collapses] = plan.actions;
  try {
    await api.createReview(prNumber, first.body);
  } catch (err) {
    // GitHub answers 422 when an inline comment doesn't land on the diff it knows (a push it
    // raced, a path it spells differently). Rather than lose the Review, post it again with every
    // Finding in the body. Anything else is a real failure.
    if (!/ failed: 422\b/.test(err.message) || !first.body.comments?.length) throw err;
    warn(`GitHub rejected the inline comments, so every Finding is in the review body instead: ${err.message}`);
    plan = planReview({ raw, executionRaw, prNumber, diff, commitId, model, earlier, allowInline: false });
    await api.createReview(prNumber, plan.actions[0].body);
  }
  // Only once the new Review is up, so a failed post never leaves the PR without a summary
  // showing. A summary that won't collapse is untidy rather than wrong, so it warns instead of
  // failing a job whose Review did post.
  for (const action of collapses) {
    try {
      await api.minimize(action.subjectId, action.classifier);
    } catch (err) {
      warn(`could not collapse an earlier Flytrap summary as outdated: ${err.message}`);
    }
  }
  return plan;
}

// A denied Write or Edit carries a whole file as its input; keep the failure reason readable.
const MAX_INPUT_CHARS = 300;
function truncate(text = 'null') {
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}… (${text.length} chars)` : text;
}
