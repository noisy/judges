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
