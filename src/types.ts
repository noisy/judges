export interface EvaluationContext {
  type: 'diff' | 'files';
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

export type JudgeStatus = 'ok' | 'error' | 'timeout' | 'skipped';

export interface JudgeResult {
  judgeId: string;
  displayName: string;
  file: string;
  status: JudgeStatus;
  issues: Issue[];
  durationMs: number;
  costUsd?: number;
  turns?: number;
  error?: string;
  skipReason?: string;
}

export type JudgeEvent =
  | { judgeId: string; state: 'running' }
  | { judgeId: string; state: 'done'; result: JudgeResult };
