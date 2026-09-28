// Reads a unified diff (as GitHub's `application/vnd.github.diff` returns it) into the ranges of
// new-file lines each hunk shows. GitHub only accepts a review comment on a line inside a hunk,
// and a range only when both ends are in the same hunk, so this is what decides whether a Finding
// can go inline.

/** @typedef {{ start: number, end: number }} Hunk  New-file lines start..end, inclusive. */

/**
 * @param {string} diff
 * @returns {Map<string, Hunk[]>} Hunks by the file's path after the change.
 */
export function parseDiff(diff) {
  /** @type {Map<string, Hunk[]>} */
  const files = new Map();
  let hunks = null;
  // Lines left in the current hunk, counted from its header, so an added line that happens to
  // start with "++ " is never mistaken for a file header.
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('+')) newLeft--;
      else if (line.startsWith('-')) oldLeft--;
      else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      else { oldLeft--; newLeft--; }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      hunks = null;
    } else if (line.startsWith('+++ ')) {
      const path = newPath(line.slice(4));
      hunks = null;
      if (path !== null) {
        hunks = files.get(path) ?? [];
        files.set(path, hunks);
      }
    } else if (line.startsWith('@@ ')) {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      const start = Number(m[2]);
      newLeft = m[3] === undefined ? 1 : Number(m[3]);
      // A hunk that only deletes shows no new-file lines to comment on.
      if (hunks && newLeft > 0) hunks.push({ start, end: start + newLeft - 1 });
    }
  }
  return files;
}

// The "+++" side of a file header: "b/path", a quoted "\"b/path\"", or /dev/null for a deletion.
function newPath(raw) {
  const text = raw.replace(/\t.*$/, '');
  if (text === '/dev/null') return null;
  const path = text.startsWith('"') ? unquote(text) : text;
  return path.startsWith('b/') ? path.slice(2) : path;
}

// Git C-quotes paths with unusual characters, writing non-ASCII bytes as octal escapes.
function unquote(text) {
  const bytes = [];
  const body = text.slice(1, text.endsWith('"') ? -1 : undefined);
  const simple = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * The hunk that holds every line from `line` to `end`, or undefined when the lines are outside
 * the diff or straddle two hunks.
 * @param {Map<string, Hunk[]>} files
 */
export function findHunk(files, path, line, end = line) {
  return files.get(path)?.find((h) => h.start <= line && end <= h.end);
}
