import { Issue } from './types.js';

const CODE_FENCE = /```[\w-]*[ \t]*\n([\s\S]*?)```/;
const FINDING_LIST_FIELDS = ['findings', 'issues'];

// Reads the findings from the model's answer: a bare array, an array with prose or a code fence
// around it, an object holding the array in `findings` or `issues`, or a single finding object.
export function parseLLMOutput(rawOutput: string): Issue[] {
  if (rawOutput.trim() === '') {
    throw new Error('Failed to parse LLM output: the answer is empty.');
  }
  const fenced = rawOutput.match(CODE_FENCE)?.[1];
  const issues = (fenced === undefined ? undefined : findIssues(fenced)) ?? findIssues(rawOutput);
  if (issues === undefined) {
    throw new Error(`Failed to parse LLM output. Raw: ${rawOutput}`);
  }
  return issues;
}

// The first JSON value in the text that holds findings. Prose may hold brackets too,
// like `[src/a.py]` or `[1]`, so a value that is not findings is passed over.
function findIssues(text: string): Issue[] | undefined {
  for (const value of jsonValues(text)) {
    const issues = asIssues(value);
    if (issues !== undefined) return issues;
  }
  return undefined;
}

function asIssues(value: unknown): Issue[] | undefined {
  if (Array.isArray(value)) {
    return value.every(isObject) ? (value as unknown as Issue[]) : undefined;
  }
  if (!isObject(value)) return undefined;
  const list = FINDING_LIST_FIELDS.map((field) => value[field]).find(Array.isArray);
  if (list !== undefined) return asIssues(list);
  return typeof value.message === 'string' ? [value as unknown as Issue] : undefined;
}

// Every JSON array or object in the text, in order; a value nested in another is not visited.
function* jsonValues(text: string): Generator<unknown> {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '[' && text[start] !== '{') continue;
    const end = closingBracket(text, start);
    if (end === undefined) continue;
    try {
      yield JSON.parse(text.slice(start, end + 1));
      start = end;
    } catch {
      // Not JSON, such as a bracket in prose; a later bracket may start the answer.
    }
  }
}

// The index of the bracket that closes the one at `start`, skipping brackets inside strings.
function closingBracket(text: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
