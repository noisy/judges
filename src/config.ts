import mri from 'mri';

export const DEFAULT_MAX_ISSUES_TO_SHOW = 3;
export const SEVERITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 };

export interface AppConfig {
  file?: string | string[];
  json: boolean;
  short: boolean;
  full: boolean;
  top?: string;
  help: boolean;
  visibleIssueLimit: number;
}

export function parseArgs(argv: string[]): AppConfig {
  const parsed = mri(argv, {
    string: ['file', 'top'],
    boolean: ['json', 'help', 'short', 'full'],
    alias: {
      f: 'file',
      j: 'json',
      h: 'help',
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

  return {
    file: parsed.file,
    json: !!parsed.json,
    short: !!parsed.short,
    full: !!parsed.full,
    top: parsed.top,
    help: !!parsed.help,
    visibleIssueLimit,
  };
}
