import { validate } from './schema.js';
import { renderReview } from './render.js';
import { findDenial } from './execution.js';

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

// Works out what would be posted. Plan mode stops here; tests assert on this.
//
// The execution transcript is checked before the Findings, and fails the job on its own even when
// the Findings happen to be well-formed: a denial partway through a run must not pass silently
// just because the model produced something that looks like a finished Review (ADR 0003).
export function planReview({ raw, executionRaw, prNumber }) {
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('a pull request number is required');
  const denial = findDenial(executionRaw);
  if (denial) {
    throw new Error(
      `the Harness's execution denied permission to use ${denial.tool} with input ${truncate(JSON.stringify(denial.input))}` +
        (denial.message ? `; the model was told: ${truncate(denial.message)}` : ''),
    );
  }
  const review = parseFindings(raw);
  return {
    actions: [
      {
        type: 'comment',
        method: 'POST',
        path: `/issues/${prNumber}/comments`,
        body: renderReview(review),
      },
    ],
  };
}

export async function postReview({ raw, executionRaw, prNumber, api }) {
  const plan = planReview({ raw, executionRaw, prNumber });
  for (const action of plan.actions) {
    await api.createComment(prNumber, action.body);
  }
  return plan;
}

// A denied Write or Edit carries a whole file as its input; keep the failure reason readable.
const MAX_INPUT_CHARS = 300;
function truncate(text = 'null') {
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}… (${text.length} chars)` : text;
}
