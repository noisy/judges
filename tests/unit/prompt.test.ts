import { describe, it, expect } from 'vitest';
import { constructPrompt, numberLines } from '../../src/prompt.js';
import { parseLLMOutput } from '../../src/llm.js';
import { Judge } from '../../src/judges.js';
import { Marker } from '../../src/markers.js';
import { EvaluationContext } from '../../src/types.js';

const oneShot = { id: 'r', name: 'r', context: 'file', mode: 'one-shot', instructions: 'Intent: be good.' } as Judge;
const diffOnly = { ...oneShot, context: 'diff' } as Judge;
const agent = { ...oneShot, context: 'repo', mode: 'agent' } as Judge;

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
  it('asks for a confidence in percent, with its scale, in every mode', () => {
    for (const judge of [oneShot, diffOnly, agent]) {
      const prompt = constructPrompt(judge, diffContext);
      expect(prompt).toContain('"confidence": "number (how sure you are that this is a violation, in percent');
      expect(prompt).toContain('- 90 to 100: a clear violation, the rule says so directly');
    }
  });

  it('shows file contents with line numbers and asks for those numbers in both modes', () => {
    for (const judge of [oneShot, agent]) {
      const prompt = constructPrompt(judge, filesContext);
      expect(prompt).toContain('4|     return requests.get(URL)');
      expect(prompt).toContain('Report those numbers in "line"');
    }
  });

  it('tells a one-shot judge on a diff to report only the added or changed lines', () => {
    const onlyNew = 'report only violations on lines the diff adds or changes';

    expect(constructPrompt(oneShot, diffContext)).toContain(onlyNew);
    expect(constructPrompt(oneShot, filesContext)).not.toContain(onlyNew);
    expect(constructPrompt(agent, diffContext)).not.toContain(onlyNew);
  });

  it('keeps the one-shot prompt free of repository instructions', () => {
    expect(constructPrompt(oneShot, diffContext)).not.toContain('Verify the rule against the repository');
  });

  it('gives an agent the rule, the files, the diff and markers, then asks it to verify against the repository', () => {
    const markers: Marker[] = [{ ruleId: 'r', kind: 'debt', reason: 'debt', file: 'src/connectors/beta.py', markerLine: 1 }];
    const prompt = constructPrompt(agent, diffContext, markers);

    const order = ['Intent: be good.', '## src/connectors/beta.py', '# Diff', '- src/connectors/beta.py:1 (rule-debt): debt',
      'Verify the rule against the repository.'].map((text) => prompt.indexOf(text));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain('Report only violations in the changed files in scope. Finish with the JSON array only.');
    expect(prompt).toContain('the files on disk may differ');
  });

  it('gives a diff rule the diff but not the whole files', () => {
    const prompt = constructPrompt(diffOnly, diffContext);
    expect(prompt).toContain('# Diff');
    expect(prompt).toContain('Only the diff is shown, not the whole files.');
    expect(prompt).not.toContain('## src/connectors/beta.py');
    expect(prompt).not.toContain('return requests.get(URL)');
  });

  it('gives a diff rule the whole files when there is no diff, as a file rule', () => {
    expect(constructPrompt(diffOnly, filesContext)).toBe(constructPrompt(oneShot, filesContext));
  });

  it('gives a file rule the diff and the whole files', () => {
    const prompt = constructPrompt(oneShot, diffContext);
    expect(prompt).toContain('# Diff');
    expect(prompt).toContain('4|     return requests.get(URL)');
  });

  it('lists each marker at its own line with its reason, and asks for covered_by', () => {
    const markers: Marker[] = [
      { ruleId: 'r', kind: 'exception', reason: 'the CLI prints its result', file: 'src/cli.py', markerLine: 2 },
      { ruleId: 'r', kind: 'debt', reason: 'move to logging later', file: 'src/export.py', markerLine: 11 }
    ];
    const prompt = constructPrompt(oneShot, filesContext, markers);

    expect(prompt).toContain('- src/cli.py:2 (rule-exception): the CLI prints its result');
    expect(prompt).toContain('- src/export.py:11 (rule-debt): move to logging later');
    expect(prompt).toContain('"covered_by"');
    expect(prompt).toContain('even right next to a marker');
  });

  it('leaves the prompt as it was when the rule has no markers', () => {
    expect(constructPrompt(oneShot, filesContext)).not.toContain('covered_by');
  });

  it('leaves parsing of the model answer unaffected by the numbered listing', () => {
    expect(parseLLMOutput('[{"file":"src/connectors/beta.py","line":4,"severity":"medium","message":"m"}]')[0].line).toBe(4);
  });
});
