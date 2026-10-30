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

// The gate a rule runs at: commit hook, push hook or pipeline.
export const STAGES = ['commit', 'push', 'ci'] as const;
export type Stage = typeof STAGES[number];

export interface Issue {
  file: string;
  line: string | number;
  severity: 'low' | 'medium' | 'high';
  message: string;
  rule_id?: string;
  confidence?: 'high' | 'medium' | 'low';
  covered_by?: string; // `<file>:<line>` of the marker that accounts for the violation
}

// One tool call an agent judge made: what it read, searched or listed.
export interface ExaminedTarget {
  tool: string;
  target: string;
  denied?: boolean; // the sandbox refused it, e.g. a path outside the repository
}

export type JudgeStatus = 'ok' | 'error' | 'stopped' | 'skipped';

// The limit that ended a `stopped` rule: its time limit, its turn cap or its cost cap.
export type StopReason = 'time' | 'turns' | 'cost';

export interface JudgeResult {
  judgeId: string;
  displayName: string;
  file: string;
  status: JudgeStatus;
  stopReason?: StopReason; // set only when status is `stopped`
  effort?: string; // the effort the rule ran with; unset when the engine used its default
  issues: Issue[];
  covered?: Issue[]; // findings a marker covers, each with its `covered_by`; not reported
  suppressed?: number; // how many findings markers covered: the length of `covered`
  outsideDiff?: number; // findings dropped because none of their lines is an added line of the diff
  dismissed?: number; // entries dropped because their message says the code follows the rule
  durationMs: number;
  costUsd?: number | null; // null when the engine never said it, e.g. on a time stop
  turns?: number | null;
  inline?: string[]; // files given to the judge in the prompt
  examined?: ExaminedTarget[]; // what an agent judge read or searched on its own
  error?: string;
  skipReason?: string;
}

export type JudgeEvent =
  | { judgeId: string; state: 'running' }
  | { judgeId: string; state: 'done'; result: JudgeResult };
