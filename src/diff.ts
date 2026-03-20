import { execSync } from 'child_process';

export function extractDiff(mode: 'staged' | 'diff' | 'head' | 'last-commit' = 'head'): string {
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
      return `No git diff found (${command}). Make sure you have uncommitted changes or use path mode (e.g., 'judge .').`;
    }
    return diff;
  } catch (error: any) {
    if (error.message.includes('fatal: ')) {
      throw new Error(`Git error: ${error.message}`);
    }
    throw new Error(`Error extracting git diff: ${error.message}`);
  }
}
