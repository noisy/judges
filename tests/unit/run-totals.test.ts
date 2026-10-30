import { describe, it, expect } from 'vitest';
import { runTotals } from '../../src/run-totals.js';
import { JudgeResult, TokenUsage, UNKNOWN_TOKENS } from '../../src/types.js';

const tokens = (input: number, cacheRead: number, output: number): TokenUsage => ({ input, cacheCreation: 0, cacheRead, output });

function result(fields: Partial<JudgeResult>): JudgeResult {
  return { judgeId: 'rule', displayName: 'rule', file: 'rule.md', status: 'ok', issues: [], durationMs: 1, ...fields };
}

describe('runTotals', () => {
  it('sums the tokens and costs of the rules that called the model, and skips the others', () => {
    const results = [
      result({ tokens: tokens(1200, 800, 40), costUsd: 0.0123 }),
      result({ tokens: tokens(1200, 800, 40), costUsd: 0.0123 }),
      result({ status: 'skipped' }),
    ];

    expect(runTotals(results)).toEqual({
      tokens: { input: 2400, cacheCreation: 0, cacheRead: 1600, output: 80 },
      tokensEstimated: false,
      costUsd: 0.0246,
      costEstimated: false
    });
  });

  it('marks the totals estimated when one rule is', () => {
    const results = [result({ tokens: tokens(1, 0, 1), costUsd: 0.01 }),
      result({ tokens: tokens(1, 0, 1), costUsd: 0.01, tokensEstimated: true, costEstimated: true })];

    expect(runTotals(results)).toMatchObject({ tokensEstimated: true, costEstimated: true });
  });

  it('makes a total unknown when one rule that called the model does not know it', () => {
    const results = [result({ tokens: tokens(1200, 800, 40), costUsd: 0.0123 }), result({ tokens: UNKNOWN_TOKENS, costUsd: null })];

    expect(runTotals(results)).toMatchObject({ tokens: UNKNOWN_TOKENS, costUsd: null });
  });

  it('gives zeros when no rule called the model', () => {
    expect(runTotals([result({ status: 'skipped' })])).toEqual({
      tokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
      tokensEstimated: false,
      costUsd: 0,
      costEstimated: false
    });
  });
});
