import { getEngine, EngineRequest, TimeoutError } from './engines/index.js';
import { parseLLMOutput } from './llm.js';
import { constructPrompt } from './prompt.js';
import { Judge, displayName } from './judges.js';
import { PlanItem } from './plan.js';
import { Marker, isCovered } from './markers.js';
import { SEVERITY_SCORE } from './config.js';
import { repoRoot } from './files.js';
import { EvaluationContext, Issue, JudgeEvent, JudgeResult, SupportedEngine } from './types.js';

type JudgeOutcome = Pick<JudgeResult, 'status' | 'issues' | 'suppressed' | 'error' | 'costUsd' | 'turns' | 'examined'>;
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
    : await runJudge(item.judge, item.context, item.markers, engine, onProgress);
  onProgress({ judgeId: item.judge.id, state: 'done', result });
  return result;
}

function skippedResult(judge: Judge, skipReason: string): JudgeResult {
  return { ...judgeIdentity(judge), status: 'skipped', issues: [], durationMs: 0, skipReason };
}

async function runJudge(
  judge: Judge,
  context: EvaluationContext,
  markers: Marker[],
  engine: SupportedEngine,
  onProgress: ProgressListener
): Promise<JudgeResult> {
  onProgress({ judgeId: judge.id, state: 'running' });
  const startedAt = Date.now();
  const outcome = await evaluateJudge(judge, context, markers, engine);

  return {
    ...judgeIdentity(judge),
    status: outcome.status,
    issues: outcome.issues,
    suppressed: outcome.suppressed,
    durationMs: Date.now() - startedAt,
    costUsd: outcome.costUsd,
    turns: outcome.turns,
    examined: outcome.examined,
    error: outcome.error
  };
}

function judgeIdentity(judge: Judge): Pick<JudgeResult, 'judgeId' | 'displayName' | 'file'> {
  return { judgeId: judge.id, displayName: displayName(judge), file: judge.filePath };
}

async function evaluateJudge(
  judge: Judge,
  context: EvaluationContext,
  markers: Marker[],
  engine: SupportedEngine
): Promise<JudgeOutcome> {
  try {
    const prompt = constructPrompt(judge, context, markers);
    const response = await getEngine(engine).run(buildEngineRequest(judge, prompt, context.root ?? repoRoot()));
    const issues = attributeToRule(judge, parseLLMOutput(response.rawOutput));
    const { kept, suppressed } = dropCovered(judge, issues, markers);
    return { status: 'ok', issues: sortBySeverity(kept), suppressed, costUsd: response.costUsd, turns: response.turns,
      examined: response.examined };
  } catch (error: any) {
    const status = error instanceof TimeoutError ? 'timeout' : 'error';
    return { status, issues: [], error: error.message };
  }
}

export function buildEngineRequest(judge: Judge, prompt: string, cwd?: string): EngineRequest {
  return {
    prompt,
    mode: judge.mode,
    cwd,
    model: judge.model,
    timeoutMs: judge.timeout_seconds * 1000,
    maxBudgetUsd: judge.max_budget_usd,
    tools: judge.tools,
    allowRead: judge.allow_read ?? [],
    maxTurns: judge.max_turns
  };
}

// A rule decides the severity of its findings; legacy judges keep what the model reported.
export function attributeToRule(judge: Judge, issues: Issue[]): Issue[] {
  if (judge.format !== 'rule') return issues;
  return issues.map((issue) => ({ ...issue, rule_id: judge.id, severity: judge.severity }));
}

// The prompt asks the judge to skip marked places; this is the guarantee when it does not.
export function dropCovered(judge: Judge, issues: Issue[], markers: Marker[]): { kept: Issue[]; suppressed: number } {
  const kept = issues.filter((issue) => !isCovered(markers, judge.id, issue.file, issue.line));
  return { kept, suppressed: issues.length - kept.length };
}

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0));
}
