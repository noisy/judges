import { describe, it, expect } from 'vitest';
import { issueSummaryLine, examinedSummary, belowThresholdNote } from '../../src/ui.js';
import { ExaminedTarget, Issue } from '../../src/types.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const issue: Issue = { file: 'a.ts', line: 1, severity: 'high', message: 'x' };

describe('issueSummaryLine', () => {
  it('shows a clean pass without a suppression note', () => {
    expect(plain(issueSummaryLine('rule-x', []))).toBe('  ✔ rule-x: 0 issues');
  });

  it('shows how many findings markers suppressed on a pass', () => {
    expect(plain(issueSummaryLine('rule-x', [], 2))).toBe('  ✔ rule-x: 0 issues (2 suppressed by markers)');
  });

  it('says how many findings min_confidence dropped', () => {
    expect(plain(issueSummaryLine('rule-x', [], 0, [], belowThresholdNote(2, 70))))
      .toBe('  ✔ rule-x: 0 issues (2 findings below min_confidence 70 not reported)');
    expect(belowThresholdNote(1, 60)).toBe('1 finding below min_confidence 60 not reported');
    expect(belowThresholdNote(0, 60)).toBe('');
  });

  it('adds the suppression note after the severity counts', () => {
    expect(plain(issueSummaryLine('rule-x', [issue], 1))).toBe('  ✘ rule-x: 1 issues (1 High; 1 suppressed by markers)');
  });
});

describe('examinedSummary', () => {
  const examined: ExaminedTarget[] = [
    { tool: 'Glob', target: 'tests/**/*.py' },
    { tool: 'Read', target: 'src/a.py' },
    { tool: 'Read', target: 'src/a.py' },
    { tool: 'Read', target: 'tests/test_a.py' },
    { tool: 'Grep', target: 'alpha in tests' },
  ];

  it('counts distinct files read and every search', () => {
    expect(examinedSummary(examined)).toBe('read 2 files, 2 searches');
  });

  it('counts sandbox denials apart from what the judge actually read', () => {
    const withDenial = [...examined, { tool: 'Read', target: '/tmp/outside.txt', denied: true }];
    expect(examinedSummary(withDenial)).toBe('read 2 files, 2 searches, 1 denied by the sandbox');
  });

  it('is empty for a judge that examined nothing', () => {
    expect(examinedSummary([])).toBe('');
  });

  it('shows what the judge examined in the summary line', () => {
    expect(plain(issueSummaryLine('rule-x', [], 0, examined))).toBe('  ✔ rule-x: 0 issues (read 2 files, 2 searches)');
    expect(plain(issueSummaryLine('rule-x', [issue], 0, [{ tool: 'Read', target: 'a' }])))
      .toBe('  ✘ rule-x: 1 issues (1 High; read 1 file)');
  });
});

