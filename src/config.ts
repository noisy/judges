import mri from 'mri';

export const DEFAULT_MAX_ISSUES_TO_SHOW = 3;
export const SEVERITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 };

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
}

export function parseArgs(argv: string[]): AppConfig {
  const parsed = mri(argv, {
    string: ['file', 'top'],
    boolean: ['json', 'help', 'version', 'short', 'full', 'staged', 'diff'],
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

  const paths = parsed._ || [];

  if (paths.length > 0 && (parsed.staged || parsed.diff)) {
    console.warn("Warning: Positional paths and git diff flags (--staged, --diff) were both provided. Falling back to paths.");
  }
  if (parsed.staged && parsed.diff) {
    console.warn("Warning: Both --staged and --diff were provided. Defaulting to --staged.");
  }

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
  };
}
