import { describe, it, expect } from 'vitest';
import { constructPrompt, numberLines } from '../../src/prompt.js';
import { parseLLMOutput } from '../../src/llm.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext } from '../../src/types.js';

const oneShot = { id: 'r', name: 'r', mode: 'one-shot', instructions: 'Intent: be good.' } as Judge;
const agent = { ...oneShot, mode: 'agent' } as Judge;

const filesContext: EvaluationContext = {
  type: 'files',
  files: [{ path: 'src/connectors/beta.py', content: 'import requests\n\ndef fetch():\n    return requests.get(URL)\n' }]
};
const diffContext: EvaluationContext = { ...filesContext, type: 'diff', rawDiff: 'diff --git a/src/connectors/beta.py b/src/connectors/beta.py\n+x' };

describe('numberLines', () => {
  it('prefixes every line with its number, padded to the widest number', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const numbered = numberLines(content).split('\n');

    expect(numbered[0]).toBe(' 1| line 1');
    expect(numbered[9]).toBe('10| line 10');
  });

  it('does not number the empty string after a trailing newline', () => {
    expect(numberLines('a\nb\n')).toBe('1| a\n2| b');
  });
});

describe('constructPrompt', () => {
  it('shows file contents with line numbers and asks for those numbers in both modes', () => {
    for (const judge of [oneShot, agent]) {
      const prompt = constructPrompt(judge, filesContext);
      expect(prompt).toContain('4|     return requests.get(URL)');
      expect(prompt).toContain('Report those numbers in "line"');
    }
  });

  it('keeps the one-shot prompt free of repository instructions', () => {
    expect(constructPrompt(oneShot, diffContext)).not.toContain('Verify the rule against the repository');
  });

  it('gives an agent the rule, the files, the diff and markers, then asks it to verify against the repository', () => {
    const markers = [{ ruleId: 'r', kind: 'todo', reason: 'debt', file: 'src/connectors/beta.py', scope: 'file' }] as any;
    const prompt = constructPrompt(agent, diffContext, markers);

    const order = ['Intent: be good.', '## src/connectors/beta.py', '# Diff', 'src/connectors/beta.py (whole file)',
      'Verify the rule against the repository.'].map((text) => prompt.indexOf(text));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain('Report only violations in the changed files in scope. Finish with the JSON array only.');
    expect(prompt).toContain('the files on disk may differ');
  });

  it('leaves parsing of the model answer unaffected by the numbered listing', () => {
    expect(parseLLMOutput('[{"file":"src/connectors/beta.py","line":4,"severity":"medium","message":"m"}]')[0].line).toBe(4);
  });
});
