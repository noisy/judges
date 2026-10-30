import { CountRange, Expected, Place } from './rule-test-spec.js';
import { parseLineRange, samePath } from './markers.js';
import { Issue, JudgeResult } from './types.js';

export interface Verdict {
  status: 'passed' | 'failed';
  reason: string | null; // `<code>: <sentence>` for a failed test
}

const PASSED: Verdict = { status: 'passed', reason: null };

// A finding count alone proves nothing: the rule must have run, and its findings must sit at the right places.
// The first check that fails gives the reason, in the order of the spec.
export function judgeTest(expected: Expected, run: JudgeResult): Verdict {
  const findings = run.issues;
  if (run.status !== 'ok') return failed('did-not-run', `the rule ended with status ${run.status}${detail(run)}`);
  if (expected.expect === 'findings' && findings.length === 0) return failed('missed', 'expected findings, got none');
  if (expected.expect === 'clean' && findings.length > 0) {
    return failed('false-positive', `expected no finding, got ${findings.length}: ${locations(findings)}`);
  }

  const unfound = expected.must.find((place) => !findings.some((finding) => isAt(finding, place)));
  if (unfound) return failed('must', `no finding at ${placeName(unfound)}; the findings are at ${locations(findings)}`);

  for (const place of expected.must_not) {
    const finding = findings.find((candidate) => isAt(candidate, place));
    if (finding) return failed('must-not', `a finding at ${location(finding)}, a place in must_not (${placeName(place)})`);
  }

  if (expected.count && !isWithin(findings.length, expected.count)) {
    return failed('count', `expected ${countName(expected.count)}, got ${findings.length}`);
  }
  return PASSED;
}

export function invalidVerdict(problem: string): Verdict {
  return failed('invalid', problem);
}

// A finding over a range of lines is at a place when the range overlaps the place's lines.
export function isAt(finding: Issue, place: Place): boolean {
  if (!samePath(finding.file, place.file)) return false;
  if (place.lines === undefined) return true;
  const range = parseLineRange(finding.line);
  return range !== null && range.from <= place.lines.to && place.lines.from <= range.to;
}

function isWithin(count: number, range: CountRange): boolean {
  return (range.min === undefined || count >= range.min) && (range.max === undefined || count <= range.max);
}

function countName({ min, max }: CountRange): string {
  if (min === max) return `exactly ${min} ${findingsWord(min!)}`;
  if (max === undefined) return `at least ${min} ${findingsWord(min!)}`;
  if (min === undefined) return `at most ${max} ${findingsWord(max)}`;
  return `${min} to ${max} findings`;
}

function findingsWord(count: number): string {
  return count === 1 ? 'finding' : 'findings';
}

function placeName(place: Place): string {
  if (place.lines === undefined) return place.file;
  const { from, to } = place.lines;
  return from === to ? `${place.file}:${from}` : `${place.file}:${from}-${to}`;
}

function locations(findings: Issue[]): string {
  return findings.length === 0 ? 'nowhere' : findings.map(location).join(', ');
}

function location(finding: Issue): string {
  return `${finding.file}:${finding.line}`;
}

function detail(run: JudgeResult): string {
  const text = run.skipReason ?? run.error?.split('\n')[0];
  return text ? ` (${text})` : '';
}

function failed(code: string, sentence: string): Verdict {
  return { status: 'failed', reason: `${code}: ${sentence}` };
}
