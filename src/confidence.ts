import { Issue } from './types.js';

// How sure the judge is of a finding, in percent. The prompt asks for a whole number from 0 to 100; an older
// answer gave a word.
const CONFIDENCE_OF_WORD: Record<string, number> = { high: 90, medium: 60, low: 30 };
const MAX_PERCENT = 100;

// A finding keeps its confidence as a whole percent, or null when none can be read from what the judge said.
export function withConfidence(issue: Issue): Issue {
  return { ...issue, confidence: readConfidence(issue.confidence) };
}

export function readConfidence(value: unknown): number | null {
  if (typeof value === 'number' && value >= 0 && value <= MAX_PERCENT) return Math.round(value);
  return typeof value === 'string' ? CONFIDENCE_OF_WORD[value] ?? null : null;
}

// `min_confidence: 70` keeps 70. A finding without a confidence is never dropped: the tool cannot judge it.
export function splitByConfidence(issues: Issue[], minConfidence?: number): { kept: Issue[]; belowThreshold: Issue[] } {
  if (minConfidence === undefined) return { kept: issues, belowThreshold: [] };
  const isBelow = (issue: Issue) => typeof issue.confidence === 'number' && issue.confidence < minConfidence;
  return { kept: issues.filter((issue) => !isBelow(issue)), belowThreshold: issues.filter(isBelow) };
}
