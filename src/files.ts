import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EvaluationContext } from './types.js';

export const MAX_FILES = 100;
export const MAX_BYTES = 1024 * 1024; // 1 MB
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.judge', '.worktree',
  '__pycache__', '.venv', 'venv', 'env', 'coverage'
]);

export function resolvePaths(filepaths: string | string[]): string[] {
  const initialPaths = Array.isArray(filepaths) ? filepaths : [filepaths];
  const resolvedFiles: string[] = [];
  let totalFiles = 0;
  let totalBytes = 0;

  function checkScanBudget(newFileSize: number): { action: 'allow' | 'stop' | 'skip', warningMsg?: string } {
    if (totalFiles >= MAX_FILES) {
      return { 
        action: 'stop', 
        warningMsg: `\n[WARNING] Too many files resolved. Limit is ${MAX_FILES}. Stopping scan.\n` 
      };
    }
    if (totalBytes + newFileSize > MAX_BYTES) {
      return { 
        action: 'skip', 
        warningMsg: `\n[WARNING] File size limit exceeded (${MAX_BYTES} bytes).\n` 
      };
    }
    return { action: 'allow' };
  }

  function traverse(currentPath: string) {
    if (totalFiles > MAX_FILES || totalBytes > MAX_BYTES) return;

    try {
      const fullPath = path.resolve(process.cwd(), String(currentPath));
      if (!fs.existsSync(fullPath)) return;

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        const basename = path.basename(fullPath);
        if (IGNORED_DIRS.has(basename)) return;

        const children = fs.readdirSync(fullPath);
        for (const child of children) {
          traverse(path.join(fullPath, child));
        }
      } else if (stats.isFile()) {
        const budgetStatus = checkScanBudget(stats.size);
        
        if (budgetStatus.warningMsg) {
          console.warn(budgetStatus.warningMsg);
        }

        if (budgetStatus.action === 'stop' || budgetStatus.action === 'skip') {
          if (budgetStatus.action === 'stop') totalFiles++;
          return;
        }

        resolvedFiles.push(fullPath);
        totalFiles++;
        totalBytes += stats.size;
      }
    } catch (error: any) {
      console.warn(`[WARNING] Error scoping ${currentPath}:`, error.message);
    }
  }

  for (const p of initialPaths) {
    traverse(p);
  }

  if (resolvedFiles.length === 0) {
    throw new Error("No valid files found or all files were ignored.");
  }

  return resolvedFiles;
}

// Paths are shown relative to the repository root, the same base git diff uses, so scope globs and markers match in both modes.
export function readContents(filepaths: string[], baseDir: string = repoRoot()): EvaluationContext {
  const files: { path: string, content: string }[] = [];
  let linesChanged = 0;

  for (const fullPath of filepaths) {
    const displayPath = path.relative(baseDir, fullPath);
    const readResult = readFileSafely(fullPath);
    
    if (readResult.skipBinary) {
      console.warn(`[WARNING] Skipping likely binary file (contains null bytes): ${displayPath}`);
      continue;
    }
    
    if (readResult.error) {
      console.warn(`[WARNING] Error reading ${fullPath}:`, readResult.error);
      continue;
    }
    
    if (readResult.content !== undefined) {
      files.push({ path: displayPath, content: readResult.content });
      linesChanged += countLines(readResult.content);
    }
  }
  
  return {
    type: 'files',
    files,
    stats: { filesChanged: files.length, linesChanged }
  };
}

// The git repository root, or the directory itself outside a repository.
export function repoRoot(cwd: string = process.cwd()): string {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

function readFileSafely(fullPath: string): { content?: string, error?: string, skipBinary?: boolean } {
  try {
    const buffer = fs.readFileSync(fullPath);
    if (buffer.includes(0)) {
      return { skipBinary: true };
    }
    return { content: buffer.toString('utf-8') };
  } catch (error: any) {
    return { error: error.message };
  }
}

function countLines(text: string): number {
  return text.split('\n').length;
}
