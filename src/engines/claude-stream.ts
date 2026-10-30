import { EngineUsage } from './process.js';
import { costAtListPrice, priceOf, roundUsd } from './prices.js';

// What a claude call used before it was killed on its time limit, read from the partial messages it streamed
// (`--include-partial-messages`). The CLI never printed its totals, and the cost it reports then is 0, so the
// tokens are added up here and the cost is estimated from the price table.

type CliEvent = Record<string, any>;

// One model message, as far as it got: `message_start` gives its input usage at once, `message_delta` its output
// when it ends. A message cut off by the kill has only the characters it streamed so far.
interface StreamedMessage {
  model: string;
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  ended: boolean;
  streamedChars: number;
}

// A rough count for the one message that was cut off; `tokensEstimated` says so.
const CHARS_PER_TOKEN = 4;

export function usageFromStream(events: CliEvent[]): EngineUsage {
  const messages = streamedMessages(events);
  const counted = messages.map((message) => ({ ...message, output: outputOf(message) }));
  const costUsd = estimatedCost(counted);
  return {
    tokens: {
      input: sum(counted, 'input'),
      cacheCreation: sum(counted, 'cacheCreation'),
      cacheRead: sum(counted, 'cacheRead'),
      output: sum(counted, 'output'),
    },
    tokensEstimated: messages.some((message) => !message.ended),
    costUsd,
    costEstimated: costUsd !== undefined,
  };
}

function streamedMessages(events: CliEvent[]): StreamedMessage[] {
  const messages: StreamedMessage[] = [];
  for (const { event } of events.filter((candidate) => candidate.type === 'stream_event')) {
    const current = messages[messages.length - 1];
    if (event?.type === 'message_start') {
      messages.push(startedMessage(event.message ?? {}));
    } else if (current && event?.type === 'content_block_delta') {
      current.streamedChars += deltaText(event.delta).length;
    } else if (current && event?.type === 'message_delta') {
      current.output = count(event.usage?.output_tokens);
      current.ended = true;
    }
  }
  return messages;
}

function startedMessage(message: CliEvent): StreamedMessage {
  const usage = message.usage ?? {};
  return {
    model: typeof message.model === 'string' ? message.model : '',
    input: count(usage.input_tokens),
    cacheCreation: count(usage.cache_creation_input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    output: 0,
    ended: false,
    streamedChars: 0,
  };
}

// Streamed text, or the JSON of a tool call's input as it is written.
function deltaText(delta: CliEvent | undefined): string {
  const text = delta?.text ?? delta?.partial_json;
  return typeof text === 'string' ? text : '';
}

function outputOf(message: StreamedMessage): number {
  return message.ended ? message.output : Math.ceil(message.streamedChars / CHARS_PER_TOKEN);
}

// Each message at the price of the model that wrote it; one model without a price leaves the cost unknown.
function estimatedCost(messages: StreamedMessage[]): number | undefined {
  let total = 0;
  for (const message of messages) {
    const price = priceOf(message.model);
    if (!price) return undefined;
    total += costAtListPrice(price, {
      input: message.input,
      cacheWrite: message.cacheCreation,
      cacheRead: message.cacheRead,
      output: message.output,
    });
  }
  return roundUsd(total);
}

function sum(messages: StreamedMessage[], part: 'input' | 'cacheCreation' | 'cacheRead' | 'output'): number {
  return messages.reduce((total, message) => total + message[part], 0);
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
