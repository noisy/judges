import { describe, it, expect } from 'vitest';
import { formatCostLine } from '../../src/format.js';
import { RunTotals } from '../../src/run-totals.js';
import { UNKNOWN_TOKENS } from '../../src/types.js';

const NOTE = 'On a Claude subscription the real cost is lower.';
const run = (fields: Partial<RunTotals>): RunTotals => ({
  tokens: { input: 2400, cacheCreation: 0, cacheRead: 1600, output: 80 },
  tokensEstimated: false,
  costUsd: 0.0246,
  costEstimated: false,
  ...fields
});

describe('formatCostLine', () => {
  it('gives the cost at API prices, the tokens and the cache share', () => {
    expect(formatCostLine(run({}))).toBe(`Cost: $0.0246 at API prices (4.1k tokens, 40% cache reads). ${NOTE}`);
  });

  it('marks an estimate, of the cost or of the tokens', () => {
    expect(formatCostLine(run({ costEstimated: true }))).toMatch(/^Cost: ≈ \$0\.0246 at API prices/);
    expect(formatCostLine(run({ tokensEstimated: true }))).toMatch(/^Cost: ≈ \$0\.0246 at API prices/);
  });

  it('says unknown when the total cost is unknown', () => {
    expect(formatCostLine(run({ costUsd: null, costEstimated: true }))).toMatch(/^Cost: unknown at API prices \(4\.1k tokens/);
  });

  it('uses 2 decimals from $1 on', () => {
    expect(formatCostLine(run({ costUsd: 1.23456 }))).toMatch(/^Cost: \$1\.23 at API prices/);
  });

  it.each([
    [{ input: 950, cacheCreation: 0, cacheRead: 0, output: 10 }, '960 tokens, 0% cache reads'],
    [{ input: 600_000, cacheCreation: 200_000, cacheRead: 400_000, output: 0 }, '1.2M tokens, 33% cache reads'],
    [UNKNOWN_TOKENS, 'tokens unknown'],
  ])('sums the tokens: %j', (tokens, summary) => {
    expect(formatCostLine(run({ tokens }))).toContain(`(${summary})`);
  });
});
