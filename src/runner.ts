import { getEngine, EngineRequest, TimeoutError } from './engines/index.js';
import { parseLLMOutput } from './llm.js';
import { constructPrompt } from './prompt.js';
import { JudgeProgress } from './ui.js';
import { Judge } from './judges.js';
import { SEVERITY_SCORE } from './config.js';
import { EvaluationContext, Issue, JudgeResult, SupportedEngine } from './types.js';

type JudgeOutcome = Pick<JudgeResult, 'status' | 'issues' | 'error' | 'costUsd' | 'turns'>;

// Engine options the judge loader may not provide yet; read defensively.
interface JudgeEngineOptions {
  timeout_seconds?: number;
  model?: string;
  tools?: string[];
  max_budget_usd?: number;
  max_turns?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 30;

export async function runJudgesParallel(
  progressList: JudgeProgress[],
  inputContext: EvaluationContext,
  engine: SupportedEngine
): Promise<JudgeResult[]> {
  return Promise.all(progressList.map((p) => runJudge(p, inputContext, engine)));
}

async function runJudge(p: JudgeProgress, inputContext: EvaluationContext, engine: SupportedEngine): Promise<JudgeResult> {
  p.state = 'running';
  const startedAt = Date.now();
  const outcome = await evaluateJudge(p.judge, inputContext, engine);

  p.state = 'done';
  p.status = outcome.status;
  p.issues = outcome.issues;
  p.error = outcome.error;

  return {
    judgeId: p.judge.id,
    displayName: p.displayName,
    file: p.judge.filePath,
    status: outcome.status,
    issues: outcome.issues,
    durationMs: Date.now() - startedAt,
    costUsd: outcome.costUsd,
    turns: outcome.turns,
    error: outcome.error
  };
}

async function evaluateJudge(judge: Judge, inputContext: EvaluationContext, engine: SupportedEngine): Promise<JudgeOutcome> {
  try {
    const prompt = constructPrompt(judge, inputContext);
    const response = await getEngine(engine).run(buildEngineRequest(judge, prompt));
    const issues = parseLLMOutput(response.rawOutput);
    return { status: 'ok', issues: sortBySeverity(issues), costUsd: response.costUsd, turns: response.turns };
  } catch (error: any) {
    const status = error instanceof TimeoutError ? 'timeout' : 'error';
    return { status, issues: [], error: error.message };
  }
}

export function buildEngineRequest(judge: Judge, prompt: string): EngineRequest {
  const options: JudgeEngineOptions = judge;
  return {
    prompt,
    model: options.model,
    timeoutMs: (options.timeout_seconds || DEFAULT_TIMEOUT_SECONDS) * 1000,
    maxBudgetUsd: options.max_budget_usd,
    tools: options.tools ?? [],
    maxTurns: options.max_turns
  };
}

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0));
}
