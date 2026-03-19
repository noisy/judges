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
    console.error("Error extracting git diff:", error.message);
    process.exit(1);
  }
}
