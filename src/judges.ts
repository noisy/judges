import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { validateJudge, validateRule, defaultSettings, ValidationResult } from './validator.js';

export interface Judge {
  id: string; // Directory name for JUDGE.md, file name for rules
  name: string;
  description: string;
  version: string;
  mode: 'one-shot' | 'agent';
  timeout_seconds: number;
  max_budget_usd?: number;
  scope: string[];
  severity: 'low' | 'medium' | 'high';
  check: 'judge' | 'deterministic';
  model?: string;
  tools: string[];
  max_turns?: number;
  command?: string;
  format: 'judge-md' | 'rule';
  instructions: string;
  filePath: string;
  isValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface JudgeSources {
  legacyDirs: string[]; // <dir>/<id>/JUDGE.md
  ruleDirs: string[];   // <dir>/<id>.md
}

const RULE_EXTENSION = '.md';

export function displayName(judge: Judge): string {
  return judge.name || judge.id;
}

export function discoverJudges(ruleDirs: string[] = []): Judge[] {
  const globalDir = path.join(os.homedir(), '.judge', 'judges');
  const localDir = path.join(process.cwd(), '.judge', 'judges');
  return loadJudges({ legacyDirs: [globalDir, localDir], ruleDirs });
}

// Later sources override earlier ones with the same id: global, local, then each rule dir.
export function loadJudges(sources: JudgeSources): Judge[] {
  const judges = [
    ...sources.legacyDirs.flatMap(findJudgeMdsInDir),
    ...sources.ruleDirs.flatMap(findRulesInDir),
  ];
  return mergeById(judges);
}

// Keeps only the judges named by --only; no names means all of them.
export function selectJudges(judges: Judge[], ids: string[]): Judge[] {
  if (ids.length === 0) return judges;

  const knownIds = new Set(judges.map(judge => judge.id));
  const unknownIds = ids.filter(id => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown judge or rule id: ${unknownIds.join(', ')}`);
  }
  return judges.filter(judge => ids.includes(judge.id));
}

function findJudgeMdsInDir(baseDir: string): Judge[] {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ id: entry.name, filePath: path.join(baseDir, entry.name, 'JUDGE.md') }))
    .filter(({ filePath }) => fs.existsSync(filePath))
    .flatMap(({ id, filePath }) => loadJudgeFile(id, filePath, 'judge-md', validateJudge));
}

function findRulesInDir(baseDir: string): Judge[] {
  if (!fs.existsSync(baseDir)) {
    throw new Error(`Rules directory not found: ${baseDir}`);
  }

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(RULE_EXTENSION))
    .map(entry => ({ id: path.basename(entry.name, RULE_EXTENSION), filePath: path.join(baseDir, entry.name) }))
    .flatMap(({ id, filePath }) => loadJudgeFile(id, filePath, 'rule', data => validateRule(data, id)));
}

function loadJudgeFile(
  id: string,
  filePath: string,
  format: Judge['format'],
  validate: (data: any) => ValidationResult,
): Judge[] {
  try {
    const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
    const validation = validate(parsed.data);
    return [toJudge(id, filePath, format, parsed, validation)];
  } catch (error: any) {
    console.error(`Error parsing ${filePath}:`, error.message);
    return [];
  }
}

function toJudge(
  id: string,
  filePath: string,
  format: Judge['format'],
  parsed: matter.GrayMatterFile<string>,
  validation: ValidationResult,
): Judge {
  const settings = validation.data ?? {
    ...defaultSettings(),
    name: parsed.data.name || id,
    description: parsed.data.description || '',
    version: '',
  };

  return {
    ...settings,
    id,
    format,
    instructions: parsed.content.trim(),
    filePath,
    isValid: validation.valid,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
}

function mergeById(judges: Judge[]): Judge[] {
  const judgeMap = new Map<string, Judge>();
  for (const judge of judges) {
    judgeMap.set(judge.id, judge);
  }
  return Array.from(judgeMap.values());
}
