import { describe, it, expect } from 'vitest';
import { issueSummaryLine } from '../../src/ui.js';
import { Issue } from '../../src/types.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const issue: Issue = { file: 'a.ts', line: 1, severity: 'high', message: 'x' };

describe('issueSummaryLine', () => {
  it('shows a clean pass without a suppression note', () => {
    expect(plain(issueSummaryLine('rule-x', []))).toBe('  ✔ rule-x: 0 issues');
  });

  it('shows how many findings markers suppressed on a pass', () => {
    expect(plain(issueSummaryLine('rule-x', [], 2))).toBe('  ✔ rule-x: 0 issues (2 suppressed by markers)');
  });

  it('adds the suppression note after the severity counts', () => {
    expect(plain(issueSummaryLine('rule-x', [issue], 1))).toBe('  ✘ rule-x: 1 issues (1 High; 1 suppressed by markers)');
  });
});
