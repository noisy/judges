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
