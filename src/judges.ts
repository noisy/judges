import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import matter from 'gray-matter';

export interface Judge {
  id: string; // Directory name
  name?: string;
  description?: string;
  instructions: string; // The markdown body
  filePath: string;
}

function findJudgesInDir(baseDir: string): Judge[] {
  const judges: Judge[] = [];

  if (!fs.existsSync(baseDir)) {
    return judges;
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const judgeDirPath = path.join(baseDir, entry.name);
      const judgeMdPath = path.join(judgeDirPath, 'JUDGE.md');

      if (fs.existsSync(judgeMdPath)) {
        try {
          const content = fs.readFileSync(judgeMdPath, 'utf-8');
          const parsed = matter(content);
          
          judges.push({
            id: entry.name,
            name: parsed.data.name,
            description: parsed.data.description,
            instructions: parsed.content.trim(),
            filePath: judgeMdPath,
          });
        } catch (error: any) {
          console.error(`Error parsing ${judgeMdPath}:`, error.message);
        }
      }
    }
  }

  return judges;
}

export function discoverJudges(): Judge[] {
  const globalDir = path.join(os.homedir(), '.judge', 'judges');
  const localDir = path.join(process.cwd(), '.judge', 'judges');

  const globalJudges = findJudgesInDir(globalDir);
  const localJudges = findJudgesInDir(localDir);

  // We merge them. Local overrides global if they have the same ID (directory name).
  const judgeMap = new Map<string, Judge>();
  
  for (const gj of globalJudges) {
    judgeMap.set(gj.id, gj);
  }
  for (const lj of localJudges) {
    judgeMap.set(lj.id, lj);
  }

  return Array.from(judgeMap.values());
}
