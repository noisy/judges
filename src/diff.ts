import { execSync } from 'child_process';

export function extractDiff(): string {
  try {
    // Get diff of staged and unstaged changes, and untracked files if needed
    // For this PoC, we will just use `git diff HEAD` or `git diff`
    const diff = execSync('git diff HEAD', { encoding: 'utf-8' });
    if (!diff.trim()) {
      return "No git diff found. Make sure you have uncommitted changes or use --file mode.";
    }
    return diff;
  } catch (error: any) {
    console.error("Error extracting git diff:", error.message);
    process.exit(1);
  }
}
