import { describe, it, expect } from 'vitest';
import { usageFromStream } from '../../src/engines/claude-stream.js';

const partial = (event: object) => ({ type: 'stream_event', event });
const messageStart = (model: string, usage: object) => partial({ type: 'message_start', message: { model, usage: { ...usage, output_tokens: 1 } } });
const textDelta = (text: string) => partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
const toolInputDelta = (json: string) => partial({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } });
const messageEnd = (outputTokens: number) => partial({ type: 'message_delta', usage: { output_tokens: outputTokens } });

describe('usageFromStream', () => {
  it('takes exact input from message_start and counts the cut-off text as output, 4 characters a token', () => {
    const events = [messageStart('claude-haiku-4-5', { input_tokens: 1200, cache_read_input_tokens: 800 }), textDelta('[{"file":"a.py"')];

    expect(usageFromStream(events)).toEqual({
      tokens: { input: 1200, cacheCreation: 0, cacheRead: 800, output: 4 },
      tokensEstimated: true,
      costUsd: 0.0013, // 1200 x $1 + 800 x $0.10 + 4 x $5, per million
      costEstimated: true
    });
  });

  it('adds up every message: the output of the ones that ended, and the cut-off tool input of the last', () => {
    const ended = [messageStart('claude-haiku-4-5', { input_tokens: 1000 }), toolInputDelta('{"pattern":"tests/**"}'), messageEnd(30)];
    const events = [...ended, ...ended, messageStart('claude-haiku-4-5', { input_tokens: 1000 }), toolInputDelta('{"file_path":"a.py"}')];

    expect(usageFromStream(events).tokens).toEqual({ input: 3000, cacheCreation: 0, cacheRead: 0, output: 65 });
  });

  it('is exact when every message ended before the kill', () => {
    const events = [messageStart('claude-haiku-4-5', { input_tokens: 1000 }), textDelta('[]'), messageEnd(3)];

    expect(usageFromStream(events)).toMatchObject({ tokensEstimated: false, costEstimated: true });
  });

  it('prices a dated model id like its undated one', () => {
    const events = [messageStart('claude-haiku-4-5-20251001', { input_tokens: 1_000_000 }), messageEnd(0)];

    expect(usageFromStream(events).costUsd).toBe(1);
  });

  it('leaves the cost unknown when a message comes from a model without a price, and keeps the tokens', () => {
    const events = [messageStart('acme-model-7', { input_tokens: 1200 }), textDelta('[]')];

    expect(usageFromStream(events)).toEqual({
      tokens: { input: 1200, cacheCreation: 0, cacheRead: 0, output: 1 },
      tokensEstimated: true,
      costUsd: undefined,
      costEstimated: false
    });
  });
});
