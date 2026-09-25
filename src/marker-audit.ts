import { Marker, findMarkersInFiles, hasReason } from './markers.js';
import { EvaluationContext, Issue, JudgeResult } from './types.js';

export const MARKERS_JUDGE_ID = 'markers';
export const MARKERS_DISPLAY_NAME = 'Markers';

// Markers are checked once per run, over the run's input files, with no model involved.
export function auditMarkers(context: EvaluationContext, knownRuleIds: string[]): JudgeResult {
  const known = new Set(knownRuleIds);
  const markers = findMarkersInFiles(context.files);
  return {
    judgeId: MARKERS_JUDGE_ID,
    displayName: MARKERS_DISPLAY_NAME,
    file: '',
    status: 'ok',
    issues: markers.flatMap((marker) => markerFindings(marker, known)),
    durationMs: 0
  };
}

function markerFindings(marker: Marker, known: Set<string>): Issue[] {
  const findings: Issue[] = [];
  if (!hasReason(marker)) {
    findings.push(finding(marker, 'medium', `rule-${marker.kind} for ${marker.ruleId} has no reason; add "-- <reason>"`));
  }
  if (!known.has(marker.ruleId)) {
    findings.push(finding(marker, 'low', `marker refers to unknown rule ${marker.ruleId}`));
  }
  return findings;
}

function finding(marker: Marker, severity: Issue['severity'], message: string): Issue {
  return { file: marker.file, line: marker.markerLine, severity, message, rule_id: marker.ruleId };
}
