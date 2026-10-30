import { createHash } from 'crypto';
import path from 'path';
import { Issue, JudgeResult } from '../types.js';

// One reported finding as every report format sees it: repository-relative, on a real line, with its fingerprint.
export interface ReportFinding {
  ruleId: string;
  path: string;
  line: number;
  message: string;
  severity: Issue['severity'];
  fingerprint: string;
}

// Suppressed findings are already gone from the results, so every report holds only what the run reported.
// The model's answer is not typed, so its fields are read defensively.
export function collectFindings(results: JudgeResult[], root: string): ReportFinding[] {
  const findings = results.flatMap((result) =>
    result.issues.map((issue) => ({
      ruleId: result.judgeId,
      path: reportPath(String(issue.file || result.file), root),
      line: reportLine(issue.line),
      message: String(issue.message ?? ''),
      severity: issue.severity
    }))
  );
  return withFingerprints(findings.sort(byRulePathLine));
}

export function ruleIds(results: JudgeResult[]): string[] {
  return results.map((result) => result.judgeId).sort(compareText);
}

// Only the position among the rule's findings in the file counts, so the fingerprint survives moved code and reworded messages.
export function fingerprint(ruleId: string, filePath: string, position: number): string {
  return createHash('sha256').update(`${ruleId}\n${filePath}\n${position}`).digest('hex');
}

function withFingerprints(sorted: Omit<ReportFinding, 'fingerprint'>[]): ReportFinding[] {
  const positions = new Map<string, number>();
  return sorted.map((finding) => {
    const key = `${finding.ruleId}\n${finding.path}`;
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    return { ...finding, fingerprint: fingerprint(finding.ruleId, finding.path, position) };
  });
}

function reportPath(file: string, root: string): string {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  return path.posix.normalize(relative.split(path.sep).join('/'));
}

// A model may give "12-14", "12" or nothing; reports need one line number, and line 1 stands for none.
function reportLine(line: Issue['line']): number {
  const parsed = parseInt(String(line), 10);
  return parsed >= 1 ? parsed : 1;
}

function byRulePathLine(a: Omit<ReportFinding, 'fingerprint'>, b: Omit<ReportFinding, 'fingerprint'>): number {
  return compareText(a.ruleId, b.ruleId) || compareText(a.path, b.path) || a.line - b.line
    || compareText(a.message, b.message);
}

// Code point order, not locale order, so every CI machine computes the same fingerprints.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
