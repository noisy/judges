import { Judge } from './judges.js';
import { scopeContext } from './scope.js';
import { Marker, accountedFor, findMarkersInFiles } from './markers.js';
import { EvaluationContext } from './types.js';

export type PlanItem =
  | { judge: Judge; context: EvaluationContext; markers: Marker[] }
  | { judge: Judge; skip: string };

export const SKIP_NO_FILES_IN_SCOPE = 'no files in scope';
export const SKIP_DETERMINISTIC = 'deterministic check (not executed yet)';

export function buildPlan(judges: Judge[], context: EvaluationContext): PlanItem[] {
  return judges.map((judge) => planJudge(judge, context));
}

function planJudge(judge: Judge, context: EvaluationContext): PlanItem {
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
