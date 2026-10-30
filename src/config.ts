import mri from 'mri';

export const DEFAULT_MAX_ISSUES_TO_SHOW = 3;
export const SEVERITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 };

import { SupportedEngine } from './types.js';

export interface AppConfig {
  file?: string | string[];
  paths: string[];
  staged: boolean;
  diff: boolean;
  json: boolean;
  short: boolean;
  full: boolean;
  top?: string;
  help: boolean;
  version: boolean;
  visibleIssueLimit: number;
  failOn?: string;
  lastCommit: boolean;
  base?: string;
  engine: SupportedEngine;
  ruleDirs: string[];
  only: string[];
  root?: string;
  command?: 'config' | 'markers';
  configAction?: 'check' | 'list' | 'show' | 'which';
  configTarget?: string;
}

export const ROOT_NEEDS_FILE_INPUT = '--root is only supported with file input';
export const BASE_NEEDS_REF = '--base needs a ref, for example --base main';

export const USAGE_ERROR_EXIT_CODE = 2;

// A mistake in how the tool was called, found before any rule runs.
export class UsageError extends Error {}

export function inputUsageError(config: AppConfig): string | undefined {
  // Diff paths are relative to the git root, so a different root would not match them.
  const hasFileInput = config.paths.length > 0 || config.file !== undefined;
  if (config.command === undefined && config.root !== undefined && !hasFileInput) return ROOT_NEEDS_FILE_INPUT;
  if (config.base === '') return BASE_NEEDS_REF;
  // An unknown threshold would turn the gate off in silence.
  if (config.failOn !== undefined && !Object.hasOwn(SEVERITY_SCORE, config.failOn)) {
    return `Unknown --fail-on value '${config.failOn}'. Use low, medium or high.`;
  }
  return undefined;
}

export function parseArgs(argv: string[]): AppConfig {
  const parsed = mri(argv, {
    string: ['file', 'top', 'fail-on', 'engine', 'show', 'which', 'rules', 'only', 'root', 'base'],
    boolean: ['json', 'help', 'version', 'short', 'full', 'staged', 'diff', 'last-commit', 'check', 'list'],
    alias: {
      f: 'file',
      j: 'json',
      h: 'help',
      v: 'version',
      s: 'short',
      t: 'top'
    }
  });

  let visibleIssueLimit = DEFAULT_MAX_ISSUES_TO_SHOW;
  if (parsed.short) {
    visibleIssueLimit = 0;
  } else if (parsed.full) {
    visibleIssueLimit = Infinity;
  } else if (parsed.top !== undefined) {
    visibleIssueLimit = parseInt(parsed.top, 10);
    if (isNaN(visibleIssueLimit)) visibleIssueLimit = DEFAULT_MAX_ISSUES_TO_SHOW;
  }

  let command: 'config' | 'markers' | undefined;
  let configAction: 'check' | 'list' | 'show' | 'which' | undefined;
  let configTarget: string | undefined;

  const paths = parsed._ || [];

  if (paths[0] === 'markers') {
    command = 'markers';
    paths.shift(); // remove 'markers'
  } else if (paths[0] === 'config') {
    command = 'config';
    paths.shift(); // remove 'config'
    if (parsed.check) {
      configAction = 'check';
      configTarget = paths.length > 0 ? paths[0] : undefined;
    } else if (parsed.list) {
      configAction = 'list';
    } else if (parsed.show) {
      configAction = 'show';
      configTarget = parsed.show;
    } else if (parsed.which) {
      configAction = 'which';
      configTarget = parsed.which;
    }
  }

  const hasBase = parsed.base !== undefined;
  if (command === undefined && paths.length > 0 && (parsed.staged || parsed.diff || parsed['last-commit'] || hasBase)) {
    console.warn("Warning: Positional paths and git diff flags (--staged, --diff, --last-commit, --base) were both provided. Falling back to paths.");
  }
  
  const activeDiffFlags = [parsed.staged, parsed.diff, parsed['last-commit'], hasBase].filter(Boolean).length;
  if (activeDiffFlags > 1) {
    console.warn("Warning: Multiple git diff flags provided (--staged, --diff, --last-commit, --base). Defaulting to the most strict requirement.");
  }
  
  let failOn = parsed['fail-on']?.toLowerCase();
  if (failOn === 'med') failOn = 'medium';

  const ruleDirs = [parsed.rules ?? []].flat();
  const only = [parsed.only ?? []].flat();

  const engine = ['codex', 'gemini'].includes(parsed.engine) ? parsed.engine as SupportedEngine : 'claude';

  return {
    file: parsed.file,
    paths,
    staged: !!parsed.staged,
    diff: !!parsed.diff,
    json: !!parsed.json,
    short: !!parsed.short,
    full: !!parsed.full,
    top: parsed.top,
    help: !!parsed.help,
    version: !!parsed.version,
    visibleIssueLimit,
    failOn,
    lastCommit: !!parsed['last-commit'],
    base: hasBase ? [parsed.base].flat().pop() : undefined, // the last --base wins when it is repeated
    engine,
    ruleDirs,
    only,
    root: parsed.root,
    command,
    configAction,
    configTarget,
  };
}
