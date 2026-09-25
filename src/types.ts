export interface EvaluationContext {
  type: 'diff' | 'files';
  root?: string; // repository root agent judges explore; the git root when unset
  rawDiff?: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  stats?: {
    filesChanged: number;
    linesChanged: number;
  };
}

export type SupportedEngine = 'claude' | 'codex' | 'gemini';

export interface Issue {
  file: string;
  line: string | number;
  severity: 'low' | 'medium' | 'high';
  message: string;
  rule_id?: string;
  confidence?: 'high' | 'medium' | 'low';
}

// One tool call an agent judge made: what it read, searched or listed.
export interface ExaminedTarget {
  tool: string;
  target: string;
  denied?: boolean; // the sandbox refused it, e.g. a path outside the repository
}

export type JudgeStatus = 'ok' | 'error' | 'timeout' | 'skipped';

export interface JudgeResult {
  judgeId: string;
  displayName: string;
  file: string;
  status: JudgeStatus;
  issues: Issue[];
  suppressed?: number; // findings dropped because a marker covers them
  durationMs: number;
  costUsd?: number;
  turns?: number;
  inline?: string[]; // files given to the judge in the prompt
  examined?: ExaminedTarget[]; // what an agent judge read or searched on its own
  error?: string;
  skipReason?: string;
}

export type JudgeEvent =
  | { judgeId: string; state: 'running' }
  | { judgeId: string; state: 'done'; result: JudgeResult };
