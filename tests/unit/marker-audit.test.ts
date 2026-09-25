import { describe, it, expect } from 'vitest';
import { auditMarkers } from '../../src/marker-audit.js';
import { shouldBlock } from '../../src/gate.js';
import { EvaluationContext } from '../../src/types.js';

function contextWith(content: string): EvaluationContext {
  return { type: 'files', files: [{ path: 'src/a.ts', content }] };
}

describe('auditMarkers', () => {
  it('returns an ok result without issues when every marker is valid', () => {
    const result = auditMarkers(contextWith('x\n// rule-ignore: known -- reason\ny'), ['known']);

    expect(result).toEqual(expect.objectContaining({ judgeId: 'markers', displayName: 'Markers', status: 'ok', issues: [] }));
  });

  it('reports a marker without a reason as a medium finding under the marker rule id', () => {
    const result = auditMarkers(contextWith('x\n// rule-todo: known\ny'), ['known']);

    expect(result.issues).toEqual([{
      file: 'src/a.ts',
      line: 2,
      severity: 'medium',
      rule_id: 'known',
      message: expect.stringContaining('rule-todo for known has no reason')
    }]);
  });

  it('reports a marker for an unknown rule as a low finding', () => {
    const result = auditMarkers(contextWith('// rule-ignore: typo-rule -- reason'), ['known']);

    expect(result.issues).toEqual([expect.objectContaining({
      severity: 'low',
      line: 1,
      message: 'marker refers to unknown rule typo-rule'
    })]);
  });

  it('counts towards --fail-on like any other finding', () => {
    const result = auditMarkers(contextWith('x\n// rule-ignore: known\ny'), ['known']);

    expect(shouldBlock([result], 'medium')).toBe(true);
  });
});
