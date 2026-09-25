import { describe, it, expect } from 'vitest';
import { buildPlan, SKIP_DETERMINISTIC, SKIP_NO_FILES_IN_SCOPE } from '../../src/plan.js';
import { defaultSettings } from '../../src/validator.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext } from '../../src/types.js';

const context: EvaluationContext = {
  type: 'files',
  files: [
    { path: 'src/a.ts', content: 'a' },
    { path: 'src/connectors/x.py', content: 'x' }
  ]
};

function judge(overrides: Partial<Judge> = {}): Judge {
  return { ...defaultSettings(), id: 'rule', ...overrides } as Judge;
}

describe('buildPlan', () => {
  it('gives an in-scope judge only the files its scope matches', () => {
    const [item] = buildPlan([judge({ scope: ['src/connectors/**/*.py'] })], context);

    expect('context' in item && item.context.files.map((f) => f.path)).toEqual(['src/connectors/x.py']);
  });

  it('skips a judge whose scope matches no file', () => {
    const [item] = buildPlan([judge({ scope: ['docs/**'] })], context);

    expect(item).toEqual(expect.objectContaining({ skip: SKIP_NO_FILES_IN_SCOPE }));
  });

  it('skips a deterministic check without scoping it', () => {
    const [item] = buildPlan([judge({ check: 'deterministic' })], context);

    expect(item).toEqual(expect.objectContaining({ skip: SKIP_DETERMINISTIC }));
  });

  it('gives a judge with the default scope every file', () => {
    const [item] = buildPlan([judge()], context);

    expect('context' in item && item.context.files).toHaveLength(2);
  });

  it('keeps the order of the judges', () => {
    const plan = buildPlan([judge({ id: 'a' }), judge({ id: 'b', scope: ['none'] })], context);

    expect(plan.map((item) => item.judge.id)).toEqual(['a', 'b']);
  });

  it('hands a judge the markers with a reason for its own id in its scoped files', () => {
    const markedContext: EvaluationContext = {
      type: 'files',
      files: [
        { path: 'src/a.ts', content: 'x\n// rule-ignore: rule -- external key\ny\n// rule-todo: rule\nz\n// rule-ignore: other -- elsewhere\nw' },
        { path: 'docs/b.md', content: '<!-- rule-ignore: rule -- out of scope -->' }
      ]
    };

    const [item] = buildPlan([judge({ scope: ['src/**'] })], markedContext);

    expect('markers' in item && item.markers.map((m) => [m.file, m.reason])).toEqual([['src/a.ts', 'external key']]);
  });
});
