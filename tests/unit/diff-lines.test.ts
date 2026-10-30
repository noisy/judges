import { describe, it, expect } from 'vitest';
import { addedLines, dropOutsideDiff, isOutsideDiff } from '../../src/diff-lines.js';
import { Issue } from '../../src/types.js';

// 14 lines inserted near the top move the old `muted` from line 8 to 22; a later hunk edits one line and adds two.
const shiftedSection = `diff --git a/src/prefs.py b/src/prefs.py
index 1111111..2222222 100644
--- a/src/prefs.py
+++ b/src/prefs.py
@@ -1,5 +1,19 @@
 """Notification preferences for users."""
 from dataclasses import dataclass, field
+from datetime import time
+
+# Quiet hours, in the user's local time.
+QUIET_START = time(22, 0)
+QUIET_END = time(7, 0)
+QUIET_KINDS = ("reminder", "digest")
+
+
+def is_quiet_time(now: time) -> bool:
+    """Return True when now falls inside the quiet hours."""
+    overnight = QUIET_START > QUIET_END
+    if overnight:
+        return now >= QUIET_START or now < QUIET_END
+    return QUIET_START <= now < QUIET_END


 @dataclass
@@ -10,9 +24,11 @@ class Preferences:
     digest: bool = True


-def channels_for(preferences, kind):
+def channels_for(preferences, kind, now):
     if preferences.muted:
         return []
+    if kind in QUIET_KINDS and is_quiet_time(now):
+        return []
     return list(preferences.channels)


`;

const newFileSection = `diff --git a/src/new.py b/src/new.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.py
@@ -0,0 +1,3 @@
+def a():
+    return 1
+
`;

const renameWithEditSection = `diff --git a/old/name.py b/src/renamed.py
similarity index 80%
rename from old/name.py
rename to src/renamed.py
index 4444444..5555555 100644
--- a/old/name.py
+++ b/src/renamed.py
@@ -3,3 +3,3 @@ def keep():
 def keep():
-    return OLD
+    return NEW
     # end
`;

const pureRenameSection = `diff --git a/old/same.py b/src/same.py
similarity index 100%
rename from old/same.py
rename to src/same.py
`;

describe('addedLines', () => {
  it('numbers added lines as in the file after the change, also after an insert above', () => {
    const lines = addedLines(shiftedSection).get('src/prefs.py');

    expect([...lines!]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 27, 30, 31]);
  });

  it('leaves context lines out, also the ones that moved', () => {
    const lines = addedLines(shiftedSection).get('src/prefs.py')!;

    expect(lines.has(22)).toBe(false);
    expect(lines.has(28)).toBe(false);
  });

  it('counts every line of a new file', () => {
    expect([...addedLines(newFileSection).get('src/new.py')!]).toEqual([1, 2, 3]);
  });

  it('keys a renamed file by its new path and numbers its edits there', () => {
    const added = addedLines(renameWithEditSection);

    expect([...added.get('src/renamed.py')!]).toEqual([4]);
    expect(added.has('old/name.py')).toBe(false);
  });

  it('gives a pure rename no added lines', () => {
    expect(addedLines(pureRenameSection).get('src/same.py')!.size).toBe(0);
  });

  it('reads a hunk header without counts and skips the no-newline note', () => {
    const section = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-const valid = true
\\ No newline at end of file
+const isValid = true
\\ No newline at end of file
`;

    expect([...addedLines(section).get('a.ts')!]).toEqual([1]);
  });

  it('counts a blank context line with or without its leading space', () => {
    const hunk = (blank: string) => ['diff --git a/a.py b/a.py', '@@ -1,2 +1,3 @@', ' x = 1', blank, '+y = 2', ''].join('\n');

    expect([...addedLines(hunk(' ')).get('a.py')!]).toEqual([3]);
    expect([...addedLines(hunk('')).get('a.py')!]).toEqual([3]);
  });

  it('counts an added line whose code starts like a file header', () => {
    const section = newFileSection.replace('+    return 1', '+++ looks like a header');

    expect([...addedLines(section).get('src/new.py')!]).toEqual([1, 2, 3]);
  });

  it('keeps the files of a multi-file diff apart', () => {
    const added = addedLines(shiftedSection + newFileSection);

    expect([...added.keys()]).toEqual(['src/prefs.py', 'src/new.py']);
  });
});

describe('isOutsideDiff', () => {
  const added = addedLines(shiftedSection + newFileSection);

  it('keeps a finding on an added line', () => {
    expect(isOutsideDiff(added, 'src/prefs.py', 13)).toBe(false);
  });

  it('drops a finding on an old line that moved down', () => {
    expect(isOutsideDiff(added, 'src/prefs.py', 22)).toBe(true);
  });

  it('drops a finding on a context line of the diff', () => {
    expect(isOutsideDiff(added, 'src/prefs.py', '28')).toBe(true);
  });

  it('keeps a range that touches an added line and drops one that does not', () => {
    expect(isOutsideDiff(added, 'src/prefs.py', '16-20')).toBe(false);
    expect(isOutsideDiff(added, 'src/prefs.py', '17-26')).toBe(true);
  });

  it('keeps a finding without a line number', () => {
    expect(isOutsideDiff(added, 'src/prefs.py', 'N/A')).toBe(false);
    expect(isOutsideDiff(added, 'global', 'N/A')).toBe(false);
  });

  it('matches a path written with a leading ./', () => {
    expect(isOutsideDiff(added, './src/new.py', 2)).toBe(false);
  });

  it('drops a numbered finding in a file the change does not touch', () => {
    expect(isOutsideDiff(added, 'src/legacy.py', 11)).toBe(true);
  });
});

describe('dropOutsideDiff', () => {
  it('keeps new findings and counts the old ones', () => {
    const issues: Issue[] = [
      { file: 'src/prefs.py', line: 13, severity: 'low', message: 'new' },
      { file: 'src/prefs.py', line: 22, severity: 'low', message: 'old, moved' },
      { file: 'src/prefs.py', line: 'N/A', severity: 'low', message: 'general' }
    ];

    const { kept, outsideDiff } = dropOutsideDiff(issues, shiftedSection);

    expect(kept.map((issue) => issue.message)).toEqual(['new', 'general']);
    expect(outsideDiff).toBe(1);
  });
});
