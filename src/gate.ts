import { SEVERITY_SCORE } from './config.js';
import { Issue, JudgeResult } from './types.js';

export function shouldBlock(results: JudgeResult[], failOn?: string): boolean {
  const threshold = failOn ? SEVERITY_SCORE[failOn] || 0 : 0;
  if (threshold === 0) return false;

  return results
    .filter((result) => result.status === 'ok')
    .some((result) => result.issues.some((issue) => severityScore(issue) >= threshold));
}

function severityScore(issue: Issue): number {
  return SEVERITY_SCORE[issue.severity?.toLowerCase()] || 0;
}
