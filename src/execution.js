// Scans the Harness's execution transcript for a denied tool call. `raw` is the content of
// claude-code-action's `execution_file` output: a JSON array of the raw Claude Agent SDK
// messages for the run. The Adapter runs with --allowedTools Read,Glob,Grep (ADR 0003, action.yml),
// so anything else comes back as a tool_result the CLI marks is_error and mentions "permission"
// in, since headless mode has no one to ask. A run can still produce well-formed Findings after a
// denial — the model just works around the missing tool — so this has to be checked on its own,
// not inferred from bad output.
//
// Errors from the allowed tools are never denials, even when they mention "permission": a Read
// of an unreadable file fails with `EACCES: permission denied`, and that's an ordinary tool
// failure the model can work around, not a sign the run was blocked.
export const ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep']);

export function findDenial(raw) {
  if (!raw || !raw.trim()) return null;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return null; // Not this function's job to validate the transcript's shape.
  }
  if (!Array.isArray(entries)) return null;

  const toolUses = new Map();
  for (const block of contentBlocks(entries)) {
    if (block?.type === 'tool_use') toolUses.set(block.id, { tool: block.name, input: block.input });
  }
  for (const block of contentBlocks(entries)) {
    if (block?.type !== 'tool_result' || !block.is_error) continue;
    const message = contentText(block.content);
    if (!/permission/i.test(message)) continue;
    const use = toolUses.get(block.tool_use_id) ?? { tool: 'unknown', input: null };
    if (ALLOWED_TOOLS.has(use.tool)) continue;
    return { ...use, message };
  }
  return null;
}

function* contentBlocks(entries) {
  for (const entry of entries) {
    yield* entry?.message?.content ?? [];
  }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  return '';
}
