import { Issue } from './types.js';

// Models sometimes add an entry for code that follows the rule ("No issue here", "This message complies").
const SAYS_NO_VIOLATION = [
  /\bno (?:[a-z-]+ )?(?:issue|violation|problem)s?\b/i,
  /\bnot a (?:finding|violation|problem|issue)\b/i,
  /\bcomplies\b/i,
  /\bfollows the rule\b/i,
  /\bis fine\b/i,
  /\bno change(?:s)? (?:is |are )?needed\b/i
];

// Any of these means the entry still asks for a change, e.g. a real finding that also clears a nearby line.
const STILL_COMPLAINS = [
  /\b(?:replace|rename|remove|delete|add|move|split|extract|use|return|raise|throw|say|tell)\b/i,
  /\bshould\b(?! not be (?:flagged|reported))/i,
  /\b(?:must|instead|missing|lacks?|vague|unclear|restates?|violates|breaks)\b/i,
  /\b(?:does|do|did)(?: not|n't)\b/i
];

export function dropNonFindings(issues: Issue[]): { kept: Issue[]; dismissed: number } {
  const kept = issues.filter((issue) => !isNonFinding(issue.message));
  return { kept, dismissed: issues.length - kept.length };
}

export function isNonFinding(message: string): boolean {
  return SAYS_NO_VIOLATION.some((phrase) => phrase.test(message))
    && !STILL_COMPLAINS.some((complaint) => complaint.test(message));
}
