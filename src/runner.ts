import { getEngine, EngineRequest, TimeoutError } from './engines/index.js';
import { parseLLMOutput } from './llm.js';
import { constructPrompt } from './prompt.js';
import { Judge, displayName } from './judges.js';
import { PlanItem } from './plan.js';
import { SEVERITY_SCORE } from './config.js';
import { EvaluationContext, Issue, JudgeEvent, JudgeResult, SupportedEngine } from './types.js';

type JudgeOutcome = Pick<JudgeResult, 'status' | 'issues' | 'error' | 'costUsd' | 'turns'>;
export type ProgressListener = (event: JudgeEvent) => void;

export async function runPlan(
  plan: PlanItem[],
  engine: SupportedEngine,
  onProgress: ProgressListener = () => {}
): Promise<JudgeResult[]> {
  return Promise.all(plan.map((item) => runPlanItem(item, engine, onProgress)));
}

async function runPlanItem(item: PlanItem, engine: SupportedEngine, onProgress: ProgressListener): Promise<JudgeResult> {
  const result = 'skip' in item
    ? skippedResult(item.judge, item.skip)
    : await runJudge(item.judge, item.context, engine, onProgress);
  onProgress({ judgeId: item.judge.id, state: 'done', result });
  return result;
}

function skippedResult(judge: Judge, skipReason: string): JudgeResult {
  return { ...judgeIdentity(judge), status: 'skipped', issues: [], durationMs: 0, skipReason };
}

async function runJudge(
  judge: Judge,
  context: EvaluationContext,
  engine: SupportedEngine,
  onProgress: ProgressListener
): Promise<JudgeResult> {
  onProgress({ judgeId: judge.id, state: 'running' });
  const startedAt = Date.now();
  const outcome = await evaluateJudge(judge, context, engine);

  return {
    ...judgeIdentity(judge),
    status: outcome.status,
    issues: outcome.issues,
    durationMs: Date.now() - startedAt,
    costUsd: outcome.costUsd,
    turns: outcome.turns,
    error: outcome.error
  };
}

function judgeIdentity(judge: Judge): Pick<JudgeResult, 'judgeId' | 'displayName' | 'file'> {
  return { judgeId: judge.id, displayName: displayName(judge), file: judge.filePath };
}

async function evaluateJudge(judge: Judge, context: EvaluationContext, engine: SupportedEngine): Promise<JudgeOutcome> {
  try {
    const prompt = constructPrompt(judge, context);
    const response = await getEngine(engine).run(buildEngineRequest(judge, prompt));
    const issues = parseLLMOutput(response.rawOutput);
    return { status: 'ok', issues: sortBySeverity(issues), costUsd: response.costUsd, turns: response.turns };
  } catch (error: any) {
    const status = error instanceof TimeoutError ? 'timeout' : 'error';
    return { status, issues: [], error: error.message };
  }
}

export function buildEngineRequest(judge: Judge, prompt: string): EngineRequest {
  return {
    prompt,
    model: judge.model,
    timeoutMs: judge.timeout_seconds * 1000,
    maxBudgetUsd: judge.max_budget_usd,
    tools: judge.tools,
    maxTurns: judge.max_turns
  };
}

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0));
}
