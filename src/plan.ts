import { Judge } from './judges.js';
import { scopeContext } from './scope.js';
import { Marker, accountedFor, findMarkersInFiles } from './markers.js';
import { EvaluationContext, Stage } from './types.js';

export type PlanItem =
  | { judge: Judge; context: EvaluationContext; markers: Marker[] }
  | { judge: Judge; skip: string }
  | { judge: Judge; invalid: string };

export const SKIP_NO_FILES_IN_SCOPE = 'no files in scope';
export const SKIP_DETERMINISTIC = 'deterministic check (not executed yet)';

// `ci` runs every rule; `commit` and `push` run only their own, so push does not repeat commit.
function runsAtStage(judge: Judge, stage: Stage): boolean {
  return stage === 'ci' || judge.stage === stage;
}

export function skipOtherStage(judge: Judge, stage: Stage): string {
  return `stage ${judge.stage} (not run at --stage ${stage})`;
}

export function buildPlan(judges: Judge[], context: EvaluationContext, stage?: Stage): PlanItem[] {
  return judges.map((judge) => planJudge(judge, context, stage));
}

function planJudge(judge: Judge, context: EvaluationContext, stage?: Stage): PlanItem {
  // An invalid rule has no stage of its own to filter on, so it is reported at every stage.
  if (!judge.isValid) {
    return { judge, invalid: `invalid rule: ${judge.validationErrors.join('; ')}` };
  }
  // Without a stage every rule runs, as before stages existed.
  if (stage !== undefined && !runsAtStage(judge, stage)) {
    return { judge, skip: skipOtherStage(judge, stage) };
  }
  if (judge.check === 'deterministic') {
    return { judge, skip: SKIP_DETERMINISTIC };
  }
  const scoped = scopeContext(context, judge.scope);
  if (scoped.files.length === 0) {
    return { judge, skip: SKIP_NO_FILES_IN_SCOPE };
  }
  const markers = accountedFor(findMarkersInFiles(scoped.files), judge.id);
  return { judge, context: scoped, markers };
}
