import { OnStop, SEVERITY_SCORE } from './config.js';
import { Issue, JudgeResult } from './types.js';

// How a review ends: passed, blocked by a finding or by a stopped rule, or passed with a warning that a rule stopped.
export type GateOutcome = 'passed' | 'blocked-by-findings' | 'blocked-by-stop' | 'stopped';

// A block wins over the warning: a run that blocks has failed, whatever else stopped.
export function gateOutcome(results: JudgeResult[], failOn: string | undefined, onStop: OnStop): GateOutcome {
  if (shouldBlock(results, failOn)) return 'blocked-by-findings';
  if (onStop === 'ignore' || stoppedRules(results).length === 0) return 'passed';
  return onStop === 'fail' ? 'blocked-by-stop' : 'stopped';
}

export function shouldBlock(results: JudgeResult[], failOn?: string): boolean {
  const threshold = failOn ? SEVERITY_SCORE[failOn] || 0 : 0;
  if (threshold === 0) return false;

  return results
    .filter((result) => result.status === 'ok')
    .some((result) => result.issues.some((issue) => severityScore(issue) >= threshold));
}

// Only a limit counts: an error or a skipped rule is no stop.
export function stoppedRules(results: JudgeResult[]): JudgeResult[] {
  return results.filter((result) => result.status === 'stopped');
}

function severityScore(issue: Issue): number {
  return SEVERITY_SCORE[issue.severity?.toLowerCase()] || 0;
}
