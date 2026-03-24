import { execSync } from 'child_process';
import { EvaluationContext } from './types.js';
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
  const gitStatusOutput = getModifiedFileEntries(command);
  const files: { path: string, content: string }[] = [];
  
  if (!gitStatusOutput) return files;
  
  const lines = gitStatusOutput.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const parsed = parseNameStatusLine(line);
    if (!parsed) continue;

    const content = loadFileContent(parsed.filePath, mode);
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

function loadFileContent(filePath: string, mode: 'staged' | 'diff' | 'head' | 'last-commit'): string | null {
  try {
    if (mode === 'staged' || mode === 'last-commit') {
      return readFromGitTree(filePath, mode);
    } else {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath, 'utf-8');
      }
    }
  } catch (fileErr: any) {
    console.warn(`[WARNING] Failed to load full file context for ${filePath}: ${fileErr.message}`);
  }
  return null;
}

function readFromGitTree(filePath: string, mode: 'staged' | 'last-commit'): string {
  const target = mode === 'staged' ? `:${filePath}` : `HEAD:${filePath}`;
  return execSync(`git show ${target}`, { encoding: 'utf-8' });
}
