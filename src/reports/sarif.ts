import { ReportFinding } from './findings.js';

const SARIF_LEVEL: Record<string, string> = { low: 'note', medium: 'warning', high: 'error' };

// SARIF 2.1.0 with one run; the driver lists every rule of the run, also those that found nothing.
export function sarifReport(findings: ReportFinding[], ruleIds: string[], version: string): string {
  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'judges', version, rules: ruleIds.map((id) => ({ id })) } },
        results: findings.map(sarifResult)
      }
    ]
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}

// partialFingerprints is what GitHub code scanning reads to tell a new finding from an old one.
function sarifResult(finding: ReportFinding) {
  return {
    ruleId: finding.ruleId,
    level: SARIF_LEVEL[finding.severity] ?? 'note',
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.path },
          region: { startLine: finding.line }
        }
      }
    ],
    partialFingerprints: { 'judges/v1': finding.fingerprint }
  };
}
