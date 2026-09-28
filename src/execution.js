// Finds a denied tool call in the Harness's execution transcript. `raw` is the content of
// claude-code-action's `execution_file` output: a JSON array of the raw Claude Agent SDK
// messages for the run, ending in a `result` message. A run can still produce well-formed
// Findings after a denial — the model just works around the missing tool — so ADR 0003 has this
// checked on its own, not inferred from bad output.
//
// The `result` message's `permission_denials` is the source of truth: the SDK's own record of
// every tool call it refused, as { tool_name, tool_use_id, tool_input }. Scanning tool errors for
// the word "permission" can't tell a denial from an ordinary failure (`EACCES`, ripgrep's
// `Permission denied (os error 13)`), and misses a denial worded any other way.
//
// No `result` message means the run died before finishing. That isn't a denial; the missing
// structured output fails the job on its own.
export function findDenial(raw) {
  if (!raw || !raw.trim()) return null;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return null; // Not this function's job to validate the transcript's shape.
  }
  if (!Array.isArray(entries)) return null;

  const result = entries.findLast((entry) => entry?.type === 'result');
  const [denial] = result?.permission_denials ?? [];
  if (!denial) return null;
  return {
    tool: denial.tool_name ?? 'unknown',
    input: denial.tool_input ?? null,
    // What the model was told, when the transcript has it; post-review adds it to the error.
    message: toolResultText(entries, denial.tool_use_id),
  };
}

function toolResultText(entries, toolUseId) {
  for (const entry of entries) {
    for (const block of entry?.message?.content ?? []) {
      if (block?.type === 'tool_result' && block.tool_use_id === toolUseId) return contentText(block.content);
    }
  }
  return '';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  return '';
}
