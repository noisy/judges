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
  engine: SupportedEngine;
  command?: 'config';
  configAction?: 'check' | 'list' | 'show' | 'which';
  configTarget?: string;
}

export function parseArgs(argv: string[]): AppConfig {
  const parsed = mri(argv, {
    string: ['file', 'top', 'fail-on', 'engine', 'show', 'which'],
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

  let command: 'config' | undefined;
  let configAction: 'check' | 'list' | 'show' | 'which' | undefined;
  let configTarget: string | undefined;

  const paths = parsed._ || [];

  if (paths[0] === 'config') {
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

  if (command !== 'config' && paths.length > 0 && (parsed.staged || parsed.diff || parsed['last-commit'])) {
    console.warn("Warning: Positional paths and git diff flags (--staged, --diff, --last-commit) were both provided. Falling back to paths.");
  }
  
  const activeDiffFlags = [parsed.staged, parsed.diff, parsed['last-commit']].filter(Boolean).length;
  if (activeDiffFlags > 1) {
    console.warn("Warning: Multiple git diff flags provided (--staged, --diff, --last-commit). Defaulting to the most strict requirement.");
  }
  
  let failOn = parsed['fail-on']?.toLowerCase();
  if (failOn === 'med') failOn = 'medium';

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
    engine,
    command,
    configAction,
    configTarget,
  };
}
