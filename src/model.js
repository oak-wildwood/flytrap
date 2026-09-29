// Which model a Review runs on, when the commenter picks one with `@flytrap use <name>`.
//
// The comment is untrusted text and the model name ends up in claude-code-action's `claude_args`,
// so it is never passed through: a name only counts if it is in this list, and what reaches the
// Adapter is the model ID from the list (ADR 0005). Adding a model is one line here.
//
// A bare family name ("sonnet") means the newest model of that family listed here, so bump it
// when a new one is added.
export const MODELS = {
  'claude-fable-5-1': ['fable', 'fable5.1'],
  'claude-opus-5-5': ['opus', 'opus5.5'],
  'claude-sonnet-5-5': ['sonnet', 'sonnet5.5'],
  'claude-haiku-4-5-20251001': ['haiku', 'haiku4.5'],
};

// "Sonnet 5.5", "sonnet5.5" and "sonnet-5-5" are the same request.
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const BY_NAME = new Map(
  Object.entries(MODELS).flatMap(([id, aliases]) => [id, ...aliases].map((name) => [normalize(name), id])),
);

// The whole line has to be the request, `@flytrap use <name>`, so "@flytrap use the new rubric" or
// "@flytrap use caution on auth" is a comment about something else, not a request for a model named
// "the". A version may come after a space ("use sonnet 5.5"), and trailing punctuation is fine.
// A name that is listed nowhere but is alone on the line is a request Flytrap can't meet, and
// gets an answer saying so.
const OVERRIDE = /(?:^|\s)@flytrap\b[,:]?[ \t]+use[ \t]+([a-z0-9][\w.-]*(?:[ \t]+\d+(?:[.-]\d+)?)?)[ \t]*[.,;:!?]*[ \t]*$/im;

// A reply that quotes an earlier comment, or a code block that shows the syntax, isn't a request.
const stripQuoted = (body) =>
  body.replace(/^[ \t]*(```|~~~)[\s\S]*?(^[ \t]*\1|$(?![\s\S]))/gm, '').replace(/^[ \t]*>.*$/gm, '');

/**
 * Returns null when the comment doesn't ask for a model, `{ name, model }` when it asks for a
 * listed one, and `{ name, model: null }` when it asks for one that isn't listed. Only the first
 * request counts.
 * @param {string} body
 * @returns {{ name: string, model: string|null }|null}
 */
export function parseModelOverride(body) {
  const match = OVERRIDE.exec(stripQuoted(body ?? ''));
  if (!match) return null;
  const name = match[1].replace(/[.-]+$/, '');
  return { name, model: BY_NAME.get(normalize(name)) ?? null };
}

// The names to show a commenter who asked for one that isn't listed.
export const MODEL_NAMES = Object.values(MODELS).map((aliases) => aliases[0]);
