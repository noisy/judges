import { Issue } from './types.js';
import { parseLineRange, samePath } from './markers.js';
import { splitDiffByFile } from './scope.js';

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// The lines each file gained in the change, numbered as in the file after the change.
// Sections are keyed by the new path, so a renamed file is found under its new name.
export function addedLines(rawDiff: string): Map<string, Set<number>> {
  return new Map(splitDiffByFile(rawDiff).map((section) => [section.path, addedInSection(section.text)]));
}

// Removed lines and "\ No newline at end of file" do not exist in the new file, so they do not count.
// An empty line is a blank context line whose leading space was stripped on the way.
function addedInSection(text: string): Set<number> {
  const added = new Set<number>();
  let next: number | null = null;
  for (const line of text.split('\n')) {
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      next = Number(hunk[1]);
    } else if (next === null) {
      continue;
    } else if (line.startsWith('+')) {
      added.add(next++);
    } else if (line.startsWith(' ') || line === '') {
      next++;
    }
  }
  return added;
}

// Old violations stay quiet: a finding is dropped when none of its lines is an added line of its file.
export function dropOutsideDiff(issues: Issue[], rawDiff: string): { kept: Issue[]; outsideDiff: number } {
  const added = addedLines(rawDiff);
  const kept = issues.filter((issue) => !isOutsideDiff(added, issue.file, issue.line));
  return { kept, outsideDiff: issues.length - kept.length };
}

// A finding without a line ("N/A", a general remark) cannot be placed, so it is kept.
export function isOutsideDiff(added: Map<string, Set<number>>, file: string, line: string | number): boolean {
  const range = parseLineRange(line);
  if (!range) return false;
  const lines = addedIn(added, file);
  for (let n = range.from; n <= range.to; n++) {
    if (lines.has(n)) return false;
  }
  return true;
}

function addedIn(added: Map<string, Set<number>>, file: string): Set<number> {
  for (const [path, lines] of added) {
    if (samePath(path, file)) return lines;
  }
  return new Set();
}
