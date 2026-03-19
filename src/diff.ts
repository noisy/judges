import { execSync } from 'child_process';

export function extractDiff(mode: 'staged' | 'diff' | 'head' = 'head'): string {
  try {
    let command = 'git diff HEAD';
    if (mode === 'staged') {
      command = 'git diff --cached';
    } else if (mode === 'diff') {
      command = 'git diff';
    }

    const diff = execSync(command, { encoding: 'utf-8' });
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
