/** @typedef {import('./schema.js').Review} Review */

// Turns a validated Review into the markdown of one PR comment: Verdict, then summary, then
// Findings. The text comes from the model, which read PR-controlled input, so it is treated as
// untrusted when rendered.

export const MARKER = '<!-- flytrap:review -->';

const VERDICT = {
  approve: '✅ Approve',
  approve_with_suggestions: '💬 Approve with suggestions',
  request_changes: '❌ Request Changes',
};

const SEVERITY = { blocker: 'Blocker', suggestion: 'Suggestion', nitpick: 'Nitpick' };
const SEVERITY_ORDER = Object.keys(SEVERITY);

const CATEGORY = {
  correctness: 'Correctness',
  security: 'Security',
  performance: 'Performance',
  maintainability: 'Maintainability',
  testing: 'Testing',
  conventions: 'Conventions',
  spec: 'Spec',
};

/** @param {Review} review */
export function renderReview(review) {
  const lines = [
    MARKER,
    `## Flytrap: ${VERDICT[review.verdict]}`,
    '',
    neutralise(review.summary.trim()),
    '',
  ];

  if (review.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push(`### Findings (${review.findings.length})`, '');
    const sorted = [...review.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      const range = f.end_line && f.end_line !== f.line ? `${f.line}-${f.end_line}` : `${f.line}`;
      lines.push(
        `- **${SEVERITY[f.severity]}** · ${CATEGORY[f.category]} · ${code(`${f.file}:${range}`)}: ` +
          neutralise(oneLine(f.title)),
        indent(neutralise(f.body.trim())),
      );
      // Inline suggested changes come with inline comments; in a summary comment the replacement
      // code is shown as a plain block.
      if (f.suggestion) lines.push(indent(fenced(f.suggestion)));
    }
  }
  return lines.join('\n') + '\n';
}

// Break @mentions so a hostile diff can't make the review ping people or teams.
function neutralise(text) {
  return text.replace(/@(?=[A-Za-z0-9])/g, '@​');
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function indent(text) {
  return text.split('\n').map((line) => (line ? `  ${line}` : '')).join('\n');
}

function longestBacktickRun(text) {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

function code(text) {
  const ticks = '`'.repeat(longestBacktickRun(text) + 1);
  return ticks.length > 1 ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`;
}

function fenced(text) {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}\n${text.replace(/\n$/, '')}\n${fence}`;
}
