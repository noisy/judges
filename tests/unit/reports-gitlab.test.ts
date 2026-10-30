import { describe, it, expect } from 'vitest';
import { gitlabReport } from '../../src/reports/gitlab.js';
import { ReportFinding } from '../../src/reports/findings.js';

function finding(severity: ReportFinding['severity'], extra: Partial<ReportFinding> = {}): ReportFinding {
  return { ruleId: 'r', path: 'src/a.py', line: 2, message: 'msg', severity, fingerprint: 'abc', ...extra };
}

describe('gitlabReport', () => {
  it('writes one Code Quality entry per finding', () => {
    const report = JSON.parse(gitlabReport([finding('high', { message: '1.23 is a magic number' })]));
    expect(report).toEqual([
      {
        description: '1.23 is a magic number',
        check_name: 'r',
        fingerprint: 'abc',
        severity: 'critical',
        location: { path: 'src/a.py', lines: { begin: 2 } }
      }
    ]);
  });

  it('maps low, medium and high to minor, major and critical', () => {
    const report = JSON.parse(gitlabReport([finding('low'), finding('medium'), finding('high')]));
    expect(report.map((entry: any) => entry.severity)).toEqual(['minor', 'major', 'critical']);
  });

  it('writes an empty array when there are no findings', () => {
    expect(JSON.parse(gitlabReport([]))).toEqual([]);
  });
});
