// API list prices in US dollars per million tokens, keyed by model id. `cacheWrite` is the 5-minute cache write.
// Source: OpenRouter /api/v1/models (the anthropic/* entries, not :batch), read on 2026-10-30. LiteLLM's
// model_prices_and_context_window.json gives the same numbers. Refresh at each release; never fetched at run time.
export interface ModelPrice {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  'claude-haiku-5-5': { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  'claude-sonnet-4-5': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4-6': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'claude-opus-4-1': { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  'claude-opus-4-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-fable-5': { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
};

const TOKENS_PER_PRICE_UNIT = 1_000_000;
const USD_DECIMALS = 6;
// A release date at the end of an id: claude-haiku-4-5-20251001.
const DATED_ID = /-\d{8}$/;

// A dated id uses the entry of its undated id. An unknown model has no price: never a guess.
export function priceOf(model: string): ModelPrice | undefined {
  return PRICES[model] ?? PRICES[model.replace(DATED_ID, '')];
}

export function costAtListPrice(price: ModelPrice, tokens: Record<keyof ModelPrice, number>): number {
  const parts = Object.keys(price) as (keyof ModelPrice)[];
  return parts.reduce((sum, part) => sum + (tokens[part] * price[part]) / TOKENS_PER_PRICE_UNIT, 0);
}

export function roundUsd(amount: number): number {
  return Number(amount.toFixed(USD_DECIMALS));
}
