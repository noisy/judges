import { describe, it, expect } from 'vitest';
import { parseLLMOutput } from '../../src/llm.js';

const finding = { file: 'src/greet.py', line: 2, severity: 'low', message: 'Use logger.info instead of print.' };
const answer = JSON.stringify([finding]);

describe('parseLLMOutput', () => {
  it('reads a bare array, and an empty one as no findings', () => {
    expect(parseLLMOutput(answer)).toEqual([finding]);
    expect(parseLLMOutput('[]')).toEqual([]);
  });

  it('reads an array with prose before and after it', () => {
    expect(parseLLMOutput(`I checked the file.\n${answer}\nThat is all.`)).toEqual([finding]);
  });

  it('passes over square brackets in the prose and in the messages', () => {
    const bracketed = { ...finding, message: 'print() writes to stdout [debug output].' };
    const output = `I read [src/greet.py] first.\n${JSON.stringify([bracketed])}\nSee [1] in the rule.`;

    expect(parseLLMOutput(output)).toEqual([bracketed]);
  });

  it('reads an array inside a code fence, with or without a language tag', () => {
    expect(parseLLMOutput('```json\n' + answer + '\n```')).toEqual([finding]);
    expect(parseLLMOutput('Here it is:\n```\n[]\n```')).toEqual([]);
  });

  it('reads the array from a findings or issues field', () => {
    expect(parseLLMOutput(JSON.stringify({ findings: [finding] }))).toEqual([finding]);
    expect(parseLLMOutput(JSON.stringify({ issues: [finding] }))).toEqual([finding]);
  });

  it('reads a single finding object as a list of one', () => {
    expect(parseLLMOutput(JSON.stringify(finding))).toEqual([finding]);
  });

  it('fails with a parse error on an empty answer', () => {
    expect(() => parseLLMOutput('  \n')).toThrow('Failed to parse LLM output: the answer is empty.');
  });

  it('fails with the raw answer when it holds no findings', () => {
    expect(() => parseLLMOutput('I could not finish [the review].')).toThrow(
      'Failed to parse LLM output. Raw: I could not finish [the review].'
    );
  });
});
