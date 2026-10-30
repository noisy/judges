import { describe, it, expect } from 'vitest';
import { sarifReport } from '../../src/reports/sarif.js';
import { ReportFinding } from '../../src/reports/findings.js';

function finding(severity: ReportFinding['severity'], extra: Partial<ReportFinding> = {}): ReportFinding {
  return { ruleId: 'r', path: 'src/a.py', line: 2, message: 'msg', severity, fingerprint: 'abc', ...extra };
}

describe('sarifReport', () => {
  it('writes one SARIF 2.1.0 run with the tool, its rules and the results', () => {
    const log = JSON.parse(sarifReport([finding('high')], ['q', 'r'], '1.2.3'));
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver).toEqual({ name: 'judges', version: '1.2.3', rules: [{ id: 'q' }, { id: 'r' }] });
    expect(log.runs[0].results).toEqual([
      {
        ruleId: 'r',
        level: 'error',
        message: { text: 'msg' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.py' }, region: { startLine: 2 } } }],
        partialFingerprints: { 'judges/v1': 'abc' }
      }
    ]);
  });

  it('maps low, medium and high to note, warning and error', () => {
    const log = JSON.parse(sarifReport([finding('low'), finding('medium'), finding('high')], ['r'], '1.0.0'));
    expect(log.runs[0].results.map((result: any) => result.level)).toEqual(['note', 'warning', 'error']);
  });

  it('writes a run with no results when there are no findings', () => {
    const log = JSON.parse(sarifReport([], ['r'], '1.0.0'));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].results).toEqual([]);
  });
});
