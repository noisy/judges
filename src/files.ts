import * as fs from 'fs';
import * as path from 'path';

export function readFiles(filepaths: string | string[]): string {
  const initialPaths = Array.isArray(filepaths) ? filepaths : [filepaths];
  let result = '';
  let totalFiles = 0;
  let totalBytes = 0;
  
  const MAX_FILES = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.judge']);

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
        if (totalFiles >= MAX_FILES) {
          console.warn(`\n[WARNING] Too many files resolved. Limit is ${MAX_FILES}. Stopping scan.\n`);
          totalFiles++;
          return;
        }

        const size = stats.size;
        if (totalBytes + size > MAX_BYTES) {
          console.warn(`\n[WARNING] File size limit exceeded (${MAX_BYTES} bytes). Skipping ${currentPath}\n`);
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        result += `\n--- File: ${currentPath} ---\n${content}\n`;
        totalFiles++;
        totalBytes += size;
      }
    } catch (error: any) {
      console.warn(`[WARNING] Error reading ${currentPath}:`, error.message);
    }
  }

  for (const p of initialPaths) {
    traverse(p);
  }

  if (totalFiles === 0) {
    console.error("No valid files found or all files were ignored.");
    process.exit(1);
  }

  return result;
}
