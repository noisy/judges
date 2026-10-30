import { ReportFinding } from './findings.js';

const GITLAB_SEVERITY: Record<string, string> = { low: 'minor', medium: 'major', high: 'critical' };

// GitLab Code Quality: a JSON array that GitLab shows next to the changed lines of a merge request.
export function gitlabReport(findings: ReportFinding[]): string {
  const entries = findings.map((finding) => ({
    description: finding.message,
    check_name: finding.ruleId,
    fingerprint: finding.fingerprint,
    severity: GITLAB_SEVERITY[finding.severity] ?? 'info',
    location: { path: finding.path, lines: { begin: finding.line } }
  }));
  return `${JSON.stringify(entries, null, 2)}\n`;
}
