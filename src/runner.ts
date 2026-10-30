import { getEngine, EngineRequest, EngineStoppedError } from './engines/index.js';
import { parseLLMOutput } from './llm.js';
import { constructPrompt } from './prompt.js';
import { Judge, displayName } from './judges.js';
import { PlanItem } from './plan.js';
import { Marker, markerPlace, namedMarker } from './markers.js';
import { dropOutsideDiff } from './diff-lines.js';
import { dropNonFindings } from './non-findings.js';
import { SEVERITY_SCORE } from './config.js';
import { repoRoot } from './files.js';
import { EvaluationContext, Issue, JudgeEvent, JudgeResult, SupportedEngine, UNKNOWN_TOKENS } from './types.js';

type JudgeOutcome = Pick<JudgeResult,
  'status' | 'stopReason' | 'issues' | 'covered' | 'suppressed' | 'outsideDiff' | 'dismissed' | 'error' | 'costUsd'
  | 'costEstimated' | 'tokens' | 'tokensEstimated' | 'turns' | 'examined'>;
// A one-shot call is one turn, also when the engine does not say so or was killed before its answer.
const ONE_SHOT_TURNS = 1;
export type ProgressListener = (event: JudgeEvent) => void;

export async function runPlan(
  plan: PlanItem[],
  engine: SupportedEngine,
  onProgress: ProgressListener = () => {}
): Promise<JudgeResult[]> {
  return Promise.all(plan.map((item) => runPlanItem(item, engine, onProgress)));
}

async function runPlanItem(item: PlanItem, engine: SupportedEngine, onProgress: ProgressListener): Promise<JudgeResult> {
  const result = await resultOf(item, engine, onProgress);
  onProgress({ judgeId: item.judge.id, state: 'done', result });
  return result;
}

async function resultOf(item: PlanItem, engine: SupportedEngine, onProgress: ProgressListener): Promise<JudgeResult> {
  if ('skip' in item) return skippedResult(item.judge, item.skip);
  if ('invalid' in item) return invalidResult(item.judge, item.invalid);
  return runJudge(item.judge, item.context, item.markers, engine, onProgress);
}

function skippedResult(judge: Judge, skipReason: string): JudgeResult {
  return { ...judgeIdentity(judge), status: 'skipped', issues: [], durationMs: 0, skipReason };
}

// An invalid rule is never sent to the model; it is reported so it is not mistaken for a passing one.
function invalidResult(judge: Judge, error: string): JudgeResult {
  return { ...judgeIdentity(judge), status: 'error', issues: [], durationMs: 0, error };
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
    effort: judge.effort,
    status: outcome.status,
    stopReason: outcome.stopReason,
    issues: outcome.issues,
    covered: outcome.covered,
    suppressed: outcome.suppressed,
    outsideDiff: outcome.outsideDiff,
    dismissed: outcome.dismissed,
    durationMs: Date.now() - startedAt,
    costUsd: outcome.costUsd ?? null,
    costEstimated: outcome.costEstimated ?? false,
    tokens: outcome.tokens ?? UNKNOWN_TOKENS,
    tokensEstimated: outcome.tokensEstimated ?? false,
    turns: turnsOf(judge, outcome),
    inline: context.files.map((file) => file.path),
    examined: outcome.examined,
    error: outcome.error
  };
}

// The record always says how many turns a rule took. Only an error may leave the count unknown: it may have
// struck before the model was called.
function turnsOf(judge: Judge, outcome: JudgeOutcome): number | null {
  if (typeof outcome.turns === 'number') return outcome.turns;
  return judge.mode === 'one-shot' && outcome.status !== 'error' ? ONE_SHOT_TURNS : null;
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
    const { rawOutput, durationMs: _, ...usage } = await getEngine(engine).run(
      buildEngineRequest(judge, prompt, context.root ?? repoRoot()));
    // Covered first: the judge may word a covered violation as accepted, and it may sit on an old line.
    const { covered, kept } = splitCovered(parseLLMOutput(rawOutput), markers);
    const { kept: violations, dismissed } = dropNonFindings(kept);
    const { kept: inChange, outsideDiff } = dropOldFindings(judge, attributeToRule(judge, violations), context);
    return { status: 'ok', issues: sortBySeverity(inChange), covered: attributeToRule(judge, covered),
      suppressed: covered.length, outsideDiff, dismissed, ...usage };
  } catch (error: any) {
    if (!(error instanceof EngineStoppedError)) return { status: 'error', issues: [], error: error.message };
    // A stopped rule reports none of its findings: its answer was cut off, and a partial list looks like a full one.
    const stopped = error.stopReason ? { status: 'stopped' as const, stopReason: error.stopReason } : { status: 'error' as const };
    return { ...stopped, issues: [], error: error.message, ...error.usage };
  }
}

export function buildEngineRequest(judge: Judge, prompt: string, cwd?: string): EngineRequest {
  return {
    prompt,
    mode: judge.mode,
    cwd,
    model: judge.model,
    effort: judge.effort,
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

// The judge says which marker covers a violation. Only the markers in its prompt can: any other `covered_by`
// covers nothing, and the finding is reported without it.
export function splitCovered(issues: Issue[], markers: Marker[]): { covered: Issue[]; kept: Issue[] } {
  const covered: Issue[] = [];
  const kept: Issue[] = [];
  for (const { covered_by, ...issue } of issues) {
    const marker = namedMarker(markers, covered_by);
    if (marker) covered.push({ ...issue, covered_by: markerPlace(marker) });
    else kept.push(issue);
  }
  return { covered, kept };
}

// On a diff, only what the change added is reported. Agent judges are left alone: they may rightly report
// an untouched caller that the change breaks.
export function dropOldFindings(
  judge: Judge,
  issues: Issue[],
  context: EvaluationContext
): { kept: Issue[]; outsideDiff?: number } {
  if (context.rawDiff === undefined || judge.mode === 'agent') return { kept: issues };
  return dropOutsideDiff(issues, context.rawDiff);
}

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0));
}
