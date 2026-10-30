import mri from 'mri';

export const DEFAULT_MAX_ISSUES_TO_SHOW = 3;
export const SEVERITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 };

import { STAGES, SupportedEngine } from './types.js';

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
  onStop: string; // what a rule stopped on a limit does to the exit code; checked by onStopUsageError
  lastCommit: boolean;
  base?: string;
  engine: SupportedEngine;
  ruleDirs: string[];
  only: string[];
  stage?: string;
  root?: string;
  formats: string[]; // report formats, paired in order with outputs
  outputs: string[];
  command?: 'config' | 'markers' | 'test';
  configAction?: 'check' | 'list' | 'show' | 'which';
  configTarget?: string;
}

export const ROOT_NEEDS_FILE_INPUT = '--root is only supported with file input';
export const BASE_NEEDS_REF = '--base needs a ref, for example --base main';

export const USAGE_ERROR_EXIT_CODE = 2;

// `warn` exits 3 when a rule stopped and nothing blocked, `fail` blocks on a stopped rule, `ignore` does neither.
export const ON_STOP_ACTIONS = ['warn', 'fail', 'ignore'] as const;
export type OnStop = typeof ON_STOP_ACTIONS[number];
const DEFAULT_ON_STOP: OnStop = 'warn';

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

// Checked like --stage: an unknown value is a usage error, not a silent default.
export function onStopUsageError(config: AppConfig): string | undefined {
  if ((ON_STOP_ACTIONS as readonly string[]).includes(config.onStop)) return undefined;
  return `Unknown --on-stop value '${config.onStop}'. Use ${ON_STOP_ACTIONS.join(', ')}.`;
}

// The name is checked here, not in parseArgs, so an unknown one is a usage error rather than a silent default.
export function stageUsageError(config: AppConfig): string | undefined {
  if (config.stage === undefined || (STAGES as readonly string[]).includes(config.stage)) return undefined;
  return `Unknown stage "${config.stage}": expected one of ${STAGES.join(', ')}`;
}

export function parseArgs(argv: string[]): AppConfig {
  const parsed = mri(argv, {
    string: ['file', 'top', 'fail-on', 'engine', 'show', 'which', 'rules', 'only', 'root', 'base', 'stage', 'format', 'output', 'on-stop'],
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

  let command: 'config' | 'markers' | 'test' | undefined;
  let configAction: 'check' | 'list' | 'show' | 'which' | undefined;
  let configTarget: string | undefined;

  const paths = parsed._ || [];

  if (paths[0] === 'markers') {
    command = 'markers';
    paths.shift(); // remove 'markers'
  } else if (paths[0] === 'test') {
    command = 'test';
    paths.shift(); // remove 'test'
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
  const formats = [parsed.format ?? []].flat();
  const outputs = [parsed.output ?? []].flat();

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
    onStop: parsed['on-stop'] === undefined ? DEFAULT_ON_STOP : String([parsed['on-stop']].flat().pop()),
    lastCommit: !!parsed['last-commit'],
    base: hasBase ? [parsed.base].flat().pop() : undefined, // the last --base wins when it is repeated
    engine,
    ruleDirs,
    only,
    stage: parsed.stage === undefined ? undefined : String(parsed.stage),
    root: parsed.root,
    formats,
    outputs,
    command,
    configAction,
    configTarget,
  };
}
