import { Expected } from './rule-test-spec.js';
import { isAt } from './rule-test-verdict.js';
import { Issue, JudgeResult } from './types.js';

// Where a `min_confidence` would work for a rule: the confidences of the findings its tests need, and of the ones
// they forbid. A threshold between the lowest needed and the highest forbidden keeps every needed finding and
// drops every forbidden one.
export interface TestConfidences {
  needed: number[];
  forbidden: number[];
}

export interface Calibration {
  neededMin: number | null; // null when no needed finding had a confidence
  forbiddenMax: number | null;
}

export const NO_CONFIDENCES: TestConfidences = { needed: [], forbidden: [] };

// The findings under the threshold count too: the calibration is how the threshold is chosen.
// Needed: at a `must` place. Forbidden: at a `must_not` place, or any finding of an `expect: clean` test.
export function testConfidences(expected: Expected, run: JudgeResult): TestConfidences {
  const findings = [...run.issues, ...(run.belowThreshold ?? [])];
  const isForbidden = (finding: Issue) =>
    expected.expect === 'clean' || expected.must_not.some((place) => isAt(finding, place));
  return {
    needed: confidencesOf(findings.filter((finding) => expected.must.some((place) => isAt(finding, place)))),
    forbidden: confidencesOf(findings.filter(isForbidden)),
  };
}

export function calibrationOf(tests: TestConfidences[]): Calibration {
  const needed = tests.flatMap((test) => test.needed);
  const forbidden = tests.flatMap((test) => test.forbidden);
  return {
    neededMin: needed.length === 0 ? null : Math.min(...needed),
    forbiddenMax: forbidden.length === 0 ? null : Math.max(...forbidden),
  };
}

// "needed findings 82 or more, forbidden 41 or less"
export function describeCalibration({ neededMin, forbiddenMax }: Calibration): string {
  const needed = neededMin === null ? 'no needed finding' : `needed findings ${neededMin} or more`;
  const forbidden = forbiddenMax === null ? 'no forbidden finding' : `forbidden ${forbiddenMax} or less`;
  return `${needed}, ${forbidden}`;
}

function confidencesOf(findings: Issue[]): number[] {
  return findings.map((finding) => finding.confidence).filter((confidence) => typeof confidence === 'number');
}
