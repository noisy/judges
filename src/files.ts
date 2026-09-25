import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EvaluationContext } from './types.js';

export const MAX_FILES = 100;
export const MAX_BYTES = 1024 * 1024; // 1 MB
const BINARY_SNIFF_BYTES = 8000;
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.judge', '.worktree',
  '__pycache__', '.venv', 'venv', 'env', 'coverage'
]);

// Named files are always read; directories expand to the files git knows about (tracked plus untracked-but-not-ignored),
// or to a plain traversal outside a repository. Binary files found by expansion are skipped silently.
export function resolvePaths(filepaths: string | string[], cwd: string = process.cwd()): string[] {
  const initialPaths = Array.isArray(filepaths) ? filepaths : [filepaths];
  const budget = new ScanBudget();
  const listFilesUnder = directoryLister(cwd);

  for (const p of initialPaths) {
    if (budget.isExhausted()) break;
    try {
      const fullPath = path.resolve(cwd, String(p));
      if (!fs.existsSync(fullPath)) continue;

      if (fs.statSync(fullPath).isDirectory()) {
        const found = listFilesUnder(fullPath).filter((file) => !isLikelyBinary(file));
        for (const file of found) budget.add(file);
      } else {
        budget.add(fullPath);
      }
    } catch (error: any) {
      console.warn(`[WARNING] Error scoping ${p}:`, error.message);
    }
  }

  if (budget.files.length === 0) {
    throw new Error("No valid files found or all files were ignored.");
  }

  return budget.files;
}

class ScanBudget {
  readonly files: string[] = [];
  private totalBytes = 0;
  private stopped = false;

  isExhausted(): boolean {
    return this.stopped;
  }

  add(fullPath: string): void {
    if (this.stopped) return;
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) return;

    if (this.files.length >= MAX_FILES) {
      console.warn(`\n[WARNING] Too many files resolved. Limit is ${MAX_FILES}. Stopping scan.\n`);
      this.stopped = true;
      return;
    }
    if (this.totalBytes + stats.size > MAX_BYTES) {
      console.warn(`\n[WARNING] File size limit exceeded (${MAX_BYTES} bytes), skipping ${path.relative(process.cwd(), fullPath)}.\n`);
      return;
    }
    this.files.push(fullPath);
    this.totalBytes += stats.size;
  }
}

// Asks git once, lazily, and reuses the listing for every requested directory.
function directoryLister(cwd: string): (dir: string) => string[] {
  let gitFiles: string[] | null | undefined;
  return (dir) => {
    if (gitFiles === undefined) gitFiles = listGitFiles(cwd);
    return gitFiles ? filesUnder(gitFiles, dir) : walkDirectory(dir);
  };
}

// Absolute paths of tracked and untracked-but-not-ignored files, or null outside a git repository.
function listGitFiles(cwd: string): string[] | null {
  try {
    const root = repoRoot(cwd);
    const output = execSync('git ls-files -z --cached --others --exclude-standard', {
      cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024
    });
    const entries = output.split('\0').filter((entry) => entry && !entry.endsWith('/'));
    return [...new Set(entries)].map((entry) => path.join(root, entry));
  } catch {
    return null;
  }
}

function filesUnder(files: string[], dir: string): string[] {
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return files.filter((file) => file.startsWith(prefix) && !isInIgnoredDir(path.relative(dir, file)) && fs.existsSync(file));
}

function isInIgnoredDir(relativePath: string): boolean {
  return relativePath.split(path.sep).slice(0, -1).some((segment) => IGNORED_DIRS.has(segment));
}

function walkDirectory(dir: string): string[] {
  if (IGNORED_DIRS.has(path.basename(dir))) return [];
  return fs.readdirSync(dir).flatMap((child) => {
    const fullPath = path.join(dir, child);
    return fs.statSync(fullPath).isDirectory() ? walkDirectory(fullPath) : [fullPath];
  });
}

// The same heuristic git uses: a null byte in the first few kilobytes.
function isLikelyBinary(fullPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(fullPath, 'r');
    const head = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, head, 0, BINARY_SNIFF_BYTES, 0);
    return head.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
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
