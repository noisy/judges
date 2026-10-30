import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { validateJudge, validateRule, defaultSettings, ValidationResult, Context, IdSource } from './validator.js';
import { UsageError } from './config.js';
import { Stage } from './types.js';

export interface Judge {
  id: string; // Directory name for JUDGE.md and RULE.md, file name for other rules
  name: string;
  description: string;
  version: string;
  context: Context; // how much the model sees
  mode: 'one-shot' | 'agent'; // how it runs, derived from `context`
  timeout_seconds: number;
  max_budget_usd?: number;
  scope: string[];
  stage: Stage;
  severity: 'low' | 'medium' | 'high';
  model?: string;
  tools: string[];
  allow_read: string[]; // directories outside the repo an agent judge may read
  max_turns?: number;
  format: 'judge-md' | 'rule';
  instructions: string;
  filePath: string;
  isValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface JudgeSources {
  legacyDirs: string[]; // <dir>/<id>/JUDGE.md
  ruleDirs: string[];   // <dir>/<id>.md and <dir>/<id>/RULE.md
}

// Where a rule is in a rules directory, before it is read; `named` is what its id must match.
interface RuleSource {
  id: string;
  filePath: string;
  named: IdSource;
}

const RULE_EXTENSION = '.md';
export const RULE_FILE = 'RULE.md';

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
    throw new UsageError(`Unknown judge or rule id: ${unknownIds.join(', ')}`);
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
    .map(({ id, filePath }) => loadJudgeFile(id, filePath, 'judge-md', validateJudge));
}

function findRulesInDir(baseDir: string): Judge[] {
  if (!fs.existsSync(baseDir)) {
    throw new UsageError(`Rules directory not found: ${baseDir}`);
  }

  const sources = findRuleSources(baseDir);
  rejectSameId(sources);
  return sources.map(source => fs.existsSync(source.filePath)
    ? loadJudgeFile(source.id, source.filePath, 'rule', data => validateRule(data, source.id, source.named))
    : withoutRuleFile(source));
}

// A rule is `<id>.md` or `<id>/RULE.md`, nothing deeper, so the .md files of a rule's tests are never rules.
function findRuleSources(baseDir: string): RuleSource[] {
  return fs.readdirSync(baseDir, { withFileTypes: true }).flatMap((entry): RuleSource[] => {
    if (entry.isFile() && entry.name.endsWith(RULE_EXTENSION)) {
      return [{ id: path.basename(entry.name, RULE_EXTENSION), filePath: path.join(baseDir, entry.name), named: 'file name' }];
    }
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      return [{ id: entry.name, filePath: path.join(baseDir, entry.name, RULE_FILE), named: 'directory name' }];
    }
    return [];
  });
}

// Inside one directory no order can decide which of the two the team means, and running one would hide the other.
function rejectSameId(sources: RuleSource[]): void {
  const files = new Map(sources.filter(source => source.named === 'file name').map(source => [source.id, source]));
  for (const directory of sources.filter(source => source.named === 'directory name')) {
    const file = files.get(directory.id);
    if (file) {
      const directoryPath = fs.existsSync(directory.filePath) ? directory.filePath : path.dirname(directory.filePath);
      throw new UsageError(`Two rules with the id "${directory.id}": ${file.filePath} and ${directoryPath}. Keep only one of them.`);
    }
  }
}

// A directory in a rules directory is meant as a rule, so a missing RULE.md is reported, never skipped in silence.
function withoutRuleFile(source: RuleSource): Judge {
  const directory = path.basename(path.dirname(source.filePath));
  const error = `error: \`${RULE_FILE}\` is missing: the rule directory ${directory}/ holds its rule in ${directory}/${RULE_FILE}`;
  const missing = { valid: false, errors: [error], warnings: [] };
  return toJudge(source.id, source.filePath, 'rule', { data: {}, content: '' } as matter.GrayMatterFile<string>, missing);
}

// The directory of a rule in the `<id>/RULE.md` form, where its tests live; undefined for any other judge.
export function ruleDirectory(judge: Judge): string | undefined {
  const isDirectoryRule = judge.format === 'rule' && path.basename(judge.filePath) === RULE_FILE;
  return isDirectoryRule ? path.dirname(judge.filePath) : undefined;
}

// How `validate` names a rule's file: `RULE.md` alone would not say which rule it is.
export function ruleFileName(judge: Judge): string {
  const directory = ruleDirectory(judge);
  return directory ? path.join(path.basename(directory), RULE_FILE) : path.basename(judge.filePath);
}

function loadJudgeFile(
  id: string,
  filePath: string,
  format: Judge['format'],
  validate: (data: any) => ValidationResult,
): Judge {
  try {
    const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
    const validation = validate(parsed.data);
    return toJudge(id, filePath, format, parsed, validation);
  } catch (error: any) {
    // A rule that cannot be read is kept as invalid, so the report shows it instead of leaving it out.
    const unreadable = { valid: false, errors: [`cannot read the frontmatter: ${error.message}`], warnings: [] };
    return toJudge(id, filePath, format, { data: {}, content: '' } as matter.GrayMatterFile<string>, unreadable);
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
