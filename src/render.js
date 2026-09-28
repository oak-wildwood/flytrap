/** @typedef {import('./schema.js').Review} Review */

// Turns a validated Review into the markdown of one GitHub review: its body and its inline
// comments. The text comes from the model, which read PR-controlled input, so it is treated as
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

/** @typedef {import('./schema.js').Finding} Finding */

// The review body: Verdict, then summary, then what became of the Findings. Those that could go
// inline are only counted here; those on lines outside the diff are listed in full, since GitHub
// would reject them as inline comments and fail the whole review.
/**
 * @param {Review} review
 * @param {{ inline: Finding[], outside: Finding[] }} placed
 */
export function renderSummary(review, { inline, outside }) {
  const lines = [
    MARKER,
    `## 🪰 Flytrap: ${VERDICT[review.verdict]}`,
    '',
    neutralise(review.summary.trim()),
    '',
  ];

  if (review.findings.length === 0) {
    lines.push('No findings.');
    return lines.join('\n') + '\n';
  }

  lines.push(`### Findings (${review.findings.length})`, '');
  if (inline.length) {
    lines.push(`${inline.length} ${inline.length === 1 ? 'is an inline comment' : 'are inline comments'} on the diff.`);
  }
  if (outside.length) {
    if (inline.length) lines.push('');
    lines.push(
      `${outside.length} ${outside.length === 1 ? 'is' : 'are'} outside the diff, so ` +
        `${outside.length === 1 ? 'it is' : 'they are'} listed here:`,
      '',
    );
    for (const f of bySeverity(outside)) {
      lines.push(
        `- **${SEVERITY[f.severity]}** · ${CATEGORY[f.category]} · ${code(`${f.file}:${range(f)}`)}: ` +
          neutralise(oneLine(f.title)),
        indent(neutralise(f.body.trim())),
      );
      // A suggested change only works inline; here the replacement code is shown as a plain block.
      if (f.suggestion) lines.push(indent(fenced(f.suggestion)));
    }
  }
  return lines.join('\n') + '\n';
}

// One inline comment. A suggestion becomes a GitHub suggested change, which replaces exactly the
// commented lines, matching the schema's "replacement code for exactly line to end_line".
/** @param {Finding} f */
export function renderInline(f) {
  const lines = [
    `**${SEVERITY[f.severity]}** · ${CATEGORY[f.category]}: ${neutralise(oneLine(f.title))}`,
    '',
    neutralise(f.body.trim()),
  ];
  if (f.suggestion) lines.push('', fenced(f.suggestion, 'suggestion'));
  return lines.join('\n') + '\n';
}

export function bySeverity(findings) {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function range(f) {
  return f.end_line && f.end_line !== f.line ? `${f.line}-${f.end_line}` : `${f.line}`;
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

function fenced(text, info = '') {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${info}\n${text.replace(/\n$/, '')}\n${fence}`;
}
