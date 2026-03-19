import * as fs from 'fs';
import * as path from 'path';

export function readFiles(filepaths: string | string[]): string {
  const paths = Array.isArray(filepaths) ? filepaths : [filepaths];
  let result = '';

  for (const p of paths) {
    try {
      const fullPath = path.resolve(process.cwd(), String(p));
      const content = fs.readFileSync(fullPath, 'utf-8');
      result += `\n--- File: ${p} ---\n${content}\n`;
    } catch (error: any) {
      console.error(`Error reading file ${p}:`, error.message);
      process.exit(1);
    }
  }

  return result;
}
