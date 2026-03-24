import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { validateJudge } from './validator.js';

export interface Judge {
  id: string; // Directory name
  name: string;
  description: string;
  version: string;
  mode: 'one-shot' | 'agent';
  timeout_seconds: number;
  instructions: string;
  filePath: string;
  isValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
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
          
          const validation = validateJudge(parsed.data);

          judges.push({
            id: entry.name,
            name: validation.data?.name || parsed.data.name || entry.name,
            description: validation.data?.description || parsed.data.description || '',
            version: validation.data?.version || '',
            mode: validation.data?.mode || 'one-shot',
            timeout_seconds: validation.data?.timeout_seconds || 30,
            instructions: parsed.content.trim(),
            filePath: judgeMdPath,
            isValid: validation.valid,
            validationErrors: validation.errors,
            validationWarnings: validation.warnings,
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

  const allJudges = Array.from(judgeMap.values());
  const validJudges: Judge[] = [];

  // Filter out invalid judges if we're not explicitly in checking mode.
  // Actually, standard runs should just skip them and warn. The index.ts will decide what to print, but here we can just warn for invalid ones.
  return allJudges;
}
