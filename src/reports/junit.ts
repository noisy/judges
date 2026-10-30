import { SEVERITY_SCORE } from '../config.js';
import { JudgeResult } from '../types.js';
import { ReportFinding, compareText } from './findings.js';

interface Counts {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

// JUnit XML: one test case per rule, so CI lists every rule as passed, failed, errored or skipped.
export function junitReport(results: JudgeResult[], findings: ReportFinding[]): string {
  const sorted = [...results].sort((a, b) => compareText(a.judgeId, b.judgeId));
  const cases = sorted.map((result) => testCase(result, findings.filter((f) => f.ruleId === result.judgeId)));
  const counts = countCases(sorted, findings);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="judges" ${countAttributes(counts)}>`,
    `  <testsuite name="judges" ${countAttributes(counts)}>`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    ''
  ].join('\n');
}

function testCase(result: JudgeResult, findings: ReportFinding[]): string {
  const open = `    <testcase classname="judges" name="${escapeXml(result.judgeId)}" time="${result.durationMs / 1000}"`;
  const outcome = caseOutcome(result, findings);
  return outcome ? `${open}>\n      ${outcome}\n    </testcase>` : `${open}/>`;
}

function caseOutcome(result: JudgeResult, findings: ReportFinding[]): string | undefined {
  if (result.status === 'error' || result.status === 'stopped') {
    const message = result.status === 'stopped' ? `stopped (${result.stopReason})` : 'errored';
    return `<error message="${message}" type="${result.status}">${escapeXml(result.error ?? '')}</error>`;
  }
  if (result.status === 'skipped') {
    return `<skipped message="${escapeXml(result.skipReason ?? '')}"/>`;
  }
  if (findings.length > 0) {
    const lines = findings.map((f) => escapeXml(`${f.path}:${f.line}: ${f.message}`)).join('\n');
    const message = `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`;
    return `<failure message="${message}" type="${escapeXml(highestSeverity(findings))}">${lines}</failure>`;
  }
  return undefined;
}

function countCases(results: JudgeResult[], findings: ReportFinding[]): Counts {
  const failed = new Set(findings.map((f) => f.ruleId));
  const ok = results.filter((r) => r.status === 'ok');
  return {
    tests: results.length,
    failures: ok.filter((r) => failed.has(r.judgeId)).length,
    errors: results.filter((r) => r.status === 'error' || r.status === 'stopped').length,
    skipped: results.filter((r) => r.status === 'skipped').length
  };
}

function countAttributes(counts: Counts): string {
  return `tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" skipped="${counts.skipped}"`;
}

// A rule's findings share its severity; the marker audit mixes severities, so the highest names the failure.
function highestSeverity(findings: ReportFinding[]): string {
  const highest = findings.reduce((top, f) => (SEVERITY_SCORE[f.severity] ?? 0) > (SEVERITY_SCORE[top.severity] ?? 0) ? f : top);
  return String(highest.severity ?? '');
}

// Control characters other than tab, newline and carriage return are not allowed in XML 1.0 at all, so they are dropped.
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
