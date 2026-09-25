import { describe, it, expect } from 'vitest';
import { shouldBlock } from '../../src/gate.js';
import { Issue, JudgeResult, JudgeStatus } from '../../src/types.js';

function result(status: JudgeStatus, severities: Issue['severity'][] = []): JudgeResult {
  return {
    judgeId: 'srp',
    displayName: 'SRP Validator',
    file: '/judges/srp/JUDGE.md',
    status,
    issues: severities.map((severity) => ({ file: 'a.ts', line: 1, severity, message: 'msg' })),
    durationMs: 10
  };
}

describe('shouldBlock', () => {
  it('never blocks without a --fail-on threshold', () => {
    expect(shouldBlock([result('ok', ['high'])], undefined)).toBe(false);
  });

  it('blocks when an ok judge reports an issue at or above the threshold', () => {
    expect(shouldBlock([result('ok', ['medium'])], 'medium')).toBe(true);
    expect(shouldBlock([result('ok', ['high'])], 'medium')).toBe(true);
  });

  it('does not block when all issues are below the threshold', () => {
    expect(shouldBlock([result('ok', ['low', 'medium'])], 'high')).toBe(false);
  });

  it('does not block on errored or timed-out judges', () => {
    expect(shouldBlock([result('error'), result('timeout')], 'low')).toBe(false);
  });

  it('ignores issues attached to non-ok results', () => {
    expect(shouldBlock([result('error', ['high'])], 'high')).toBe(false);
  });

  it('does not block on an unknown threshold', () => {
    expect(shouldBlock([result('ok', ['high'])], 'critical')).toBe(false);
  });
});
