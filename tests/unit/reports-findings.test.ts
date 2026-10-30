import { describe, it, expect } from 'vitest';
import { collectFindings, fingerprint, ruleIds } from '../../src/reports/findings.js';
import { Issue, JudgeResult } from '../../src/types.js';

const ROOT = '/repo';

function result(judgeId: string, issues: Partial<Issue>[] = [], extra: Partial<JudgeResult> = {}): JudgeResult {
  return {
    judgeId,
    displayName: judgeId,
    file: `/rules/${judgeId}.md`,
    status: 'ok',
    issues: issues.map((issue) => ({ file: 'src/a.py', line: 1, severity: 'high', message: 'msg', ...issue })),
    durationMs: 10,
    ...extra
  };
}

describe('fingerprint', () => {
  it('is the sha256 hex of rule id, path and position', () => {
    expect(fingerprint('no-magic-numbers', 'src/cart.py', 1))
      .toBe('693a5b84f2052a2f6790cdd3c7925dde22faa940a74ddbd36e1011af410e2cdb');
  });
});

describe('collectFindings', () => {
  it('sorts by rule id, then path, then line', () => {
    const findings = collectFindings([
      result('b-rule', [{ file: 'src/z.py', line: 3 }]),
      result('a-rule', [{ file: 'src/z.py', line: 9 }, { file: 'src/z.py', line: 2 }, { file: 'src/b.py', line: 5 }])
    ], ROOT);
    expect(findings.map((f) => `${f.ruleId} ${f.path}:${f.line}`)).toEqual([
      'a-rule src/b.py:5',
      'a-rule src/z.py:2',
      'a-rule src/z.py:9',
      'b-rule src/z.py:3'
    ]);
  });

  it('numbers findings per rule and file by line, so the line itself is not in the fingerprint', () => {
    const findings = collectFindings([
      result('r', [{ file: 'src/a.py', line: 40, message: 'later' }, { file: 'src/a.py', line: 12, message: 'first' }])
    ], ROOT);
    expect(findings.map((f) => f.fingerprint)).toEqual([fingerprint('r', 'src/a.py', 1), fingerprint('r', 'src/a.py', 2)]);
  });

  it('orders findings on the same line by message', () => {
    const findings = collectFindings([
      result('r', [{ line: 4, message: 'beta' }, { line: 4, message: 'alpha' }])
    ], ROOT);
    expect(findings.map((f) => [f.message, f.fingerprint])).toEqual([
      ['alpha', fingerprint('r', 'src/a.py', 1)],
      ['beta', fingerprint('r', 'src/a.py', 2)]
    ]);
  });

  it('starts the count again for every rule and file', () => {
    const findings = collectFindings([
      result('r', [{ file: 'src/a.py' }, { file: 'src/b.py' }]),
      result('s', [{ file: 'src/a.py' }])
    ], ROOT);
    expect(findings.map((f) => f.fingerprint)).toEqual([
      fingerprint('r', 'src/a.py', 1),
      fingerprint('r', 'src/b.py', 1),
      fingerprint('s', 'src/a.py', 1)
    ]);
  });

  it('places a finding with no usable line on line 1 and takes the first line of a range', () => {
    const findings = collectFindings([
      result('r', [{ line: '' }, { line: 'N/A' }, { line: 0 }, { line: '12-14' }])
    ], ROOT);
    expect(findings.map((f) => f.line)).toEqual([1, 1, 1, 12]);
  });

  it('makes absolute paths relative to the root and places a finding with no file on the rule file', () => {
    const findings = collectFindings([
      result('r', [{ file: '/repo/src/a.py' }, { file: './src/b.py' }, { file: '' }], { file: '/repo/rules/r.md' })
    ], ROOT);
    expect(findings.map((f) => f.path)).toEqual(['rules/r.md', 'src/a.py', 'src/b.py']);
  });

  it('names a finding after the result that reported it, so marker audit findings belong to "markers"', () => {
    const findings = collectFindings([result('markers', [{ rule_id: 'no-magic-numbers' }])], ROOT);
    expect(findings[0].ruleId).toBe('markers');
  });

  it('has nothing to report for skipped, errored and empty results', () => {
    const findings = collectFindings([
      result('a', [], { status: 'skipped' }),
      result('b', [], { status: 'error' }),
      result('c')
    ], ROOT);
    expect(findings).toEqual([]);
  });
});

describe('ruleIds', () => {
  it('lists every result id in code point order', () => {
    expect(ruleIds([result('b'), result('Z'), result('a')])).toEqual(['Z', 'a', 'b']);
  });
});
