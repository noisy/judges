import { execSync } from 'child_process';
import { EvaluationContext } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const MAX_DIFF_FILES_WARNING_THRESHOLD = 10;
const MAX_DIFF_LINES_WARNING_THRESHOLD = 500;

export function extractDiff(mode: 'staged' | 'diff' | 'head' | 'last-commit' = 'head'): EvaluationContext {
  try {
    let command = 'git diff HEAD';
    if (mode === 'staged') {
      command = 'git diff --cached';
    } else if (mode === 'diff') {
      command = 'git diff';
    } else if (mode === 'last-commit') {
      command = 'git diff HEAD~1 HEAD';
    }

    let diff = '';
    try {
      diff = execSync(command, { encoding: 'utf-8' });
    } catch (cmdError: any) {
      if (mode === 'last-commit' && cmdError.message.includes('fatal: ')) {
        // Fallback for initial commit where HEAD~1 doesn't exist
        diff = execSync('git show HEAD --format=""', { encoding: 'utf-8' });
      } else {
        throw cmdError;
      }
    }
    if (!diff.trim()) {
      throw new Error(`No git diff found (${command}). Make sure you have uncommitted changes or use path mode (e.g., 'judge .').`);
    }

    const files = parseModifiedFiles(command, mode);
    const linesChanged = diff.split('\n').length;
    
    if (files.length > MAX_DIFF_FILES_WARNING_THRESHOLD || linesChanged > MAX_DIFF_LINES_WARNING_THRESHOLD) {
      console.warn(`\n[WARNING] Large commit detected: ${files.length} files changed, ~${linesChanged} lines in diff. Consider splitting large commits.\n`);
    }

    return {
      type: 'diff',
      rawDiff: diff,
      files,
      stats: { filesChanged: files.length, linesChanged }
    };
  } catch (error: any) {
    if (error.message.includes('fatal: ')) {
      throw new Error(`Git error: ${error.message}`);
    }
    throw new Error(`Error extracting git diff: ${error.message}`);
  }
}

function parseModifiedFiles(command: string, mode: 'staged' | 'diff' | 'head' | 'last-commit'): { path: string, content: string }[] {
  const nameStatusCmd = command.replace('git diff', 'git diff --name-status');
  let gitStatusOutput = '';
  try {
    gitStatusOutput = execSync(nameStatusCmd, { encoding: 'utf-8' });
  } catch (err) {
    return [];
  }

  const files: { path: string, content: string }[] = [];
  if (!gitStatusOutput) return files;
  
  const lines = gitStatusOutput.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const parts = line.split('\t');
    const status = parts[0][0]; 
    if (status === 'D') continue; 
    
    const filePath = parts[parts.length - 1]; 

    try {
      let content = '';
      if (mode === 'staged' || mode === 'last-commit') {
        content = readFromGitTree(filePath, mode);
      } else {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(fullPath)) {
            content = fs.readFileSync(fullPath, 'utf-8');
        }
      }
      files.push({ path: filePath, content });
    } catch (fileErr: any) {
      console.warn(`[WARNING] Failed to load full file context for ${filePath}: ${fileErr.message}`);
    }
  }
  return files;
}

function readFromGitTree(filePath: string, mode: 'staged' | 'last-commit'): string {
  const target = mode === 'staged' ? `:${filePath}` : `HEAD:${filePath}`;
  return execSync(`git show ${target}`, { encoding: 'utf-8' });
}
