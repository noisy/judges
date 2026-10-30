import { execFileSync, execSync } from 'child_process';
import { EvaluationContext } from './types.js';
import { repoRoot } from './files.js';
import { UsageError } from './config.js';
import * as fs from 'fs';
import * as path from 'path';

const MAX_DIFF_FILES_WARNING_THRESHOLD = 10;
const MAX_DIFF_LINES_WARNING_THRESHOLD = 500;

export type DiffMode = 'staged' | 'diff' | 'head' | 'last-commit' | 'base';

// `baseRef` is the ref given to --base; the other modes ignore it.
export function extractDiff(mode: DiffMode = 'head', baseRef?: string): EvaluationContext {
  try {
    const command = buildDiffCommand(mode, baseRef);
    const diff = runDiffCommand(command, mode);
    
    if (!diff.trim()) {
      throw emptyDiffError(command, mode, baseRef);
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
    if (error instanceof UsageError) throw error;
    if (error.message.includes('fatal: ')) {
      throw new Error(`Git error: ${error.message}`);
    }
    throw new Error(`Error extracting git diff: ${error.message}`);
  }
}

function buildDiffCommand(mode: DiffMode, baseRef?: string): string {
  if (mode === 'staged') return 'git diff --cached';
  if (mode === 'diff') return 'git diff';
  if (mode === 'last-commit') return 'git diff HEAD~1 HEAD';
  if (mode === 'base') return `git diff ${resolveBaseCommit(baseRef ?? '')}...HEAD`;
  return 'git diff HEAD';
}

// The ref goes into a shell command, so only its commit id is used there. A ref that does not resolve is never
// replaced by another base: the review would show a different change than the one asked for.
function resolveBaseCommit(ref: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf-8' }).trim();
  } catch {
    throw new UsageError(`Unknown base ref '${ref}': it does not name a commit. In a shallow clone, fetch it first.`);
  }
}

function emptyDiffError(command: string, mode: DiffMode, baseRef?: string): Error {
  if (mode === 'base') {
    return new UsageError(`No changes on this branch since it left '${baseRef}' (${command}).`);
  }
  if (mode === 'staged') {
    return new UsageError(`Nothing is staged (${command}). Stage your changes with git add, or use path mode (e.g., 'judge .').`);
  }
  return new Error(`No git diff found (${command}). Make sure you have uncommitted changes or use path mode (e.g., 'judge .').`);
}

function runDiffCommand(command: string, mode: DiffMode): string {
  try {
    return execSync(command, { encoding: 'utf-8' });
  } catch (cmdError: any) {
    return handleLastCommitFallback(cmdError, mode);
  }
}

function handleLastCommitFallback(error: any, mode: DiffMode): string {
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

function parseModifiedFiles(command: string, mode: DiffMode): { path: string, content: string }[] {
  const gitStatusOutput = getModifiedFileEntries(command);
  const files: { path: string, content: string }[] = [];
  
  if (!gitStatusOutput) return files;
  
  const lines = gitStatusOutput.split('\n').filter(l => l.trim());
  const root = repoRoot();
  for (const line of lines) {
    const parsed = parseNameStatusLine(line);
    if (!parsed) continue;

    const content = loadFileContent(parsed.filePath, mode, root);
    if (content !== null) {
      files.push({ path: parsed.filePath, content });
    }
  }
  return files;
}

function getModifiedFileEntries(command: string): string {
  const nameStatusCmd = command.replace('git diff', 'git diff --name-status');
  try {
    return execSync(nameStatusCmd, { encoding: 'utf-8' });
  } catch (err) {
    return '';
  }
}

function parseNameStatusLine(line: string): { status: string, filePath: string } | null {
  const parts = line.split('\t');
  const status = parts[0][0]; 
  if (status === 'D') return null; 
  
  const filePath = parts[parts.length - 1];
  return { status, filePath };
}

// Git reports paths relative to the repository root, so the working-tree copy is read from there, not from cwd.
// The tree specs `:<path>` and `HEAD:<path>` are root-relative too (only `./` makes them cwd-relative).
function loadFileContent(filePath: string, mode: DiffMode, root: string): string | null {
  try {
    if (mode === 'staged' || mode === 'last-commit' || mode === 'base') {
      return readFromGitTree(filePath, mode);
    } else {
      const fullPath = path.resolve(root, filePath);
      if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath, 'utf-8');
      }
    }
  } catch (fileErr: any) {
    console.warn(`[WARNING] Failed to load full file context for ${filePath}: ${fileErr.message}`);
  }
  return null;
}

function readFromGitTree(filePath: string, mode: 'staged' | 'last-commit' | 'base'): string {
  const target = mode === 'staged' ? `:${filePath}` : `HEAD:${filePath}`;
  return execSync(`git show ${target}`, { encoding: 'utf-8' });
}
