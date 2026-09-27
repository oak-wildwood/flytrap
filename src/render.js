// Turns a validated Review into the markdown of one PR comment: Verdict, then summary, then
// Findings. The text comes from the model, which read PR-controlled input, so it is treated as
// untrusted when rendered.

export const MARKER = '<!-- nuthatch:review -->';

const VERDICT_ICON = {
  'Approve': '✅',
  'Approve with suggestions': '💬',
  'Request Changes': '❌',
};

const SEVERITY_ORDER = ['Blocker', 'Suggestion', 'Nitpick'];

export function renderReview(review) {
  const lines = [
    MARKER,
    `## ${VERDICT_ICON[review.verdict]} Nuthatch: ${review.verdict}`,
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
        `- **${f.severity}** · ${f.category} · ${code(`${f.path}:${range}`)}: ${neutralise(oneLine(f.title))}`,
        indent(neutralise(f.body.trim())),
      );
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

function code(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  return longest ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`;
}
