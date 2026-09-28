import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHunk, parseDiff } from '../src/diff.js';

const lines = (...rows) => rows.join('\n');

// Just the hunks, as plain objects, for deepEqual.
const hunksOf = (diff) => Object.fromEntries([...parseDiff(diff)].map(([path, hunks]) => [path, hunks]));

test('reads each hunk as a range of new-file lines', () => {
  const diff = lines(
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,4 @@',
    ' one',
    '+two',
    ' three',
    ' four',
    '@@ -20,2 +21,2 @@',
    '-old',
    '+new',
    ' same',
  );
  assert.deepEqual(hunksOf(diff), { 'src/a.js': [{ start: 1, end: 4 }, { start: 21, end: 22 }] });
});

test('a hunk header without counts is one line', () => {
  const diff = lines('--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+b');
  assert.deepEqual(hunksOf(diff), { 'a.txt': [{ start: 1, end: 1 }] });
});

test('an added line starting with "++ " is content, not a file header', () => {
  const diff = lines(
    '--- a/notes.md',
    '+++ b/notes.md',
    '@@ -1,1 +1,3 @@',
    ' keep',
    '+++ b/not-a-file.md',
    '+more',
  );
  assert.deepEqual(hunksOf(diff), { 'notes.md': [{ start: 1, end: 3 }] });
});

test('"\\ No newline at end of file" counts for neither side', () => {
  const diff = lines(
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-a',
    '\\ No newline at end of file',
    '+b',
    '\\ No newline at end of file',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -1 +1 @@',
    '-c',
    '+d',
  );
  assert.deepEqual(hunksOf(diff), { 'a.txt': [{ start: 1, end: 1 }], 'b.txt': [{ start: 1, end: 1 }] });
});

test('a deleted file and a deletion-only hunk have no lines to comment on', () => {
  const diff = lines(
    'diff --git a/gone.js b/gone.js',
    'deleted file mode 100644',
    '--- a/gone.js',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
    '--- a/kept.js',
    '+++ b/kept.js',
    '@@ -5,2 +4,0 @@',
    '-x',
    '-y',
  );
  assert.deepEqual(hunksOf(diff), { 'kept.js': [] });
});

test('a rename is keyed by its new path', () => {
  const diff = lines(
    'diff --git a/old/name.js b/new/name.js',
    'similarity index 90%',
    'rename from old/name.js',
    'rename to new/name.js',
    '--- a/old/name.js',
    '+++ b/new/name.js',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  );
  assert.deepEqual(hunksOf(diff), { 'new/name.js': [{ start: 1, end: 1 }] });
});

test('a binary file and a pure rename show no hunks', () => {
  const diff = lines(
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git a/a.js b/b.js',
    'similarity index 100%',
    'rename from a.js',
    'rename to b.js',
  );
  assert.deepEqual(hunksOf(diff), {});
});

test('a path with a space drops the trailing tab git adds', () => {
  const diff = lines('--- a/my file.txt\t', '+++ b/my file.txt\t', '@@ -1 +1 @@', '-a', '+b');
  assert.deepEqual(hunksOf(diff), { 'my file.txt': [{ start: 1, end: 1 }] });
});

test('a C-quoted path is unquoted, octal escapes included', () => {
  const diff = lines(
    '--- "a/caf\\303\\251.txt"',
    '+++ "b/caf\\303\\251.txt"',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '--- "a/say \\"hi\\"\\tnow.txt"',
    '+++ "b/say \\"hi\\"\\tnow.txt"',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  );
  assert.deepEqual(Object.keys(hunksOf(diff)), ['café.txt', 'say "hi"\tnow.txt']);
});

test('findHunk needs both ends of a range in the same hunk', () => {
  const files = parseDiff(lines(
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,2 +1,2 @@',
    ' a',
    ' b',
    '@@ -10,2 +10,2 @@',
    ' c',
    ' d',
  ));
  assert.deepEqual(findHunk(files, 'a.js', 1, 2), { start: 1, end: 2 });
  assert.equal(findHunk(files, 'a.js', 2, 10), undefined);
  assert.equal(findHunk(files, 'a.js', 5), undefined);
  assert.equal(findHunk(files, 'other.js', 1), undefined);
});
