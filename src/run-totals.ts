import { roundUsd } from './engines/prices.js';
import { JudgeResult, TokenUsage } from './types.js';

// What the whole run used, at API prices: the last entry of `--json` and the cost line of the human report.
export interface RunTotals {
  tokens: TokenUsage;
  tokensEstimated: boolean;
  costUsd: number | null;
  costEstimated: boolean;
}

const TOKEN_PARTS = ['input', 'cacheCreation', 'cacheRead', 'output'] as const;

// Every rule that called the model has tokens in its record; a skipped or invalid rule and the marker audit have none.
export function calledModel(result: JudgeResult): boolean {
  return result.tokens !== undefined;
}

// With no rule that called the model, every total is 0.
export function runTotals(results: JudgeResult[]): RunTotals {
  const called = results.filter(calledModel);
  const tokens = Object.fromEntries(
    TOKEN_PARTS.map((part) => [part, total(called.map((result) => result.tokens?.[part] ?? null))])
  ) as unknown as TokenUsage;
  const costUsd = total(called.map((result) => result.costUsd ?? null));
  return {
    tokens,
    tokensEstimated: called.some((result) => result.tokensEstimated === true),
    costUsd: costUsd === null ? null : roundUsd(costUsd),
    costEstimated: called.some((result) => result.costEstimated === true),
  };
}

// A partial sum would look like the whole, so one unknown value makes the total unknown.
function total(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}
