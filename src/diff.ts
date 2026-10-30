import { execFileSync, execSync } from 'child_process';
import { EvaluationContext } from './types.js';
import { BINARY_SNIFF_BYTES, repoRoot } from './files.js';
import * as fs from 'fs';
import * as path from 'path';

const MAX_DIFF_FILES_WARNING_THRESHOLD = 10;
const MAX_DIFF_LINES_WARNING_THRESHOLD = 500;

export function extractDiff(mode: 'staged' | 'diff' | 'head' | 'last-commit' = 'head'): EvaluationContext {
  try {
    const command = buildDiffCommand(mode);
    const diff = runDiffCommand(command, mode);
    
    if (!diff.trim()) {
      throw new Error(`No git diff found (${command}). Make sure you have uncommitted changes or use path mode (e.g., 'judge .').`);
    }

    const files = parseModifiedFiles(command, mode);
    const stats = buildDiffStats(diff, files);
    
    warnIfDiffIsLarge(stats);

    return {
      type: 'diff',
      rawDiff: diff,
      files,
      stats
    };
  } catch (error: any) {
    if (error.message.includes('fatal: ')) {
      throw new Error(`Git error: ${error.message}`);
    }
    throw new Error(`Error extracting git diff: ${error.message}`);
  }
}

function buildDiffCommand(mode: 'staged' | 'diff' | 'head' | 'last-commit'): string {
  if (mode === 'staged') return 'git diff --cached';
  if (mode === 'diff') return 'git diff';
  if (mode === 'last-commit') return 'git diff HEAD~1 HEAD';
  return 'git diff HEAD';
}

function runDiffCommand(command: string, mode: 'staged' | 'diff' | 'head' | 'last-commit'): string {
  try {
    return execSync(command, { encoding: 'utf-8' });
  } catch (cmdError: any) {
    return handleLastCommitFallback(cmdError, mode);
  }
}

function handleLastCommitFallback(error: any, mode: 'staged' | 'diff' | 'head' | 'last-commit'): string {
  if (mode === 'last-commit' && error.message.includes('fatal: ')) {
    return execSync('git show HEAD --format=""', { encoding: 'utf-8' });
  }
  throw error;
}

function buildDiffStats(diff: string, files: any[]): { filesChanged: number, linesChanged: number } {
  return {
    filesChanged: files.length,
    linesChanged: diff.split('\n').length
  };
}

function warnIfDiffIsLarge(stats: { filesChanged: number, linesChanged: number }): void {
  if (stats.filesChanged > MAX_DIFF_FILES_WARNING_THRESHOLD || stats.linesChanged > MAX_DIFF_LINES_WARNING_THRESHOLD) {
    console.warn(`\n[WARNING] Large commit detected: ${stats.filesChanged} files changed, ~${stats.linesChanged} lines in diff. Consider splitting large commits.\n`);
  }
}

function parseModifiedFiles(command: string, mode: 'staged' | 'diff' | 'head' | 'last-commit'): { path: string, content: string }[] {
  const files: { path: string, content: string }[] = [];
  const root = repoRoot();
  for (const entry of parseNameStatus(getModifiedFileEntries(command))) {
    if (entry.status === 'D') continue;

    const content = loadFileContent(entry.filePath, mode, root);
    if (content !== null) {
      files.push({ path: entry.filePath, content });
    }
  }
  return files;
}

// -z keeps git from quoting names with spaces or non-ASCII characters, and no shell sees them.
function getModifiedFileEntries(command: string): string {
  const [, , ...revisions] = command.split(' ');
  try {
    return execFileSync('git', ['diff', '--name-status', '-z', ...revisions], { encoding: 'utf-8' });
  } catch (err) {
    return '';
  }
}

// Each entry is a status and its path, or a status and two paths (from, to) for a rename or a copy.
function parseNameStatus(output: string): { status: string, filePath: string }[] {
  const fields = output.split('\0');
  const entries: { status: string, filePath: string }[] = [];
  let i = 0;
  while (fields[i]) {
    const status = fields[i][0];
    const pathCount = status === 'R' || status === 'C' ? 2 : 1;
    entries.push({ status, filePath: fields[i + pathCount] });
    i += pathCount + 1;
  }
  return entries;
}

// Git reports paths relative to the repository root, so the working-tree copy is read from there, not from cwd.
// The tree specs `:<path>` and `HEAD:<path>` are root-relative too (only `./` makes them cwd-relative).
function loadFileContent(filePath: string, mode: 'staged' | 'diff' | 'head' | 'last-commit', root: string): string | null {
  try {
    if (mode === 'staged' || mode === 'last-commit') {
      return asText(readFromGitTree(filePath, mode));
    } else {
      const fullPath = path.resolve(root, filePath);
      if (fs.existsSync(fullPath)) {
          return asText(fs.readFileSync(fullPath));
      }
    }
  } catch (fileErr: any) {
    console.warn(`[WARNING] Failed to load full file context for ${filePath}: ${fileErr.message}`);
  }
  return null;
}

function readFromGitTree(filePath: string, mode: 'staged' | 'last-commit'): Buffer {
  const target = mode === 'staged' ? `:${filePath}` : `HEAD:${filePath}`;
  return execFileSync('git', ['show', target]);
}

// Binary the way git decides it, by a null byte near the start, whatever the file is called.
// A binary file has no lines to judge, so none of its bytes go to the model.
function asText(content: Buffer): string | null {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0) ? null : content.toString('utf-8');
}
