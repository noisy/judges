import { describe, it, expect } from 'vitest';
import { buildPlan, skipOtherStage, SKIP_NO_FILES_IN_SCOPE } from '../../src/plan.js';
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
  return { ...defaultSettings(), id: 'rule', isValid: true, validationErrors: [], ...overrides } as Judge;
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

  it('marks an invalid rule with its validation errors instead of running it', () => {
    const invalid = judge({ isValid: false, validationErrors: ['severity: unknown value', 'model: unknown'] });

    const [item] = buildPlan([invalid], context);

    expect(item).toEqual({ judge: invalid, invalid: 'invalid rule: severity: unknown value; model: unknown' });
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

describe('buildPlan with a stage', () => {
  const rules = [
    judge({ id: 'commit-rule', stage: 'commit' }),
    judge({ id: 'push-rule', stage: 'push' }),
    judge({ id: 'ci-rule', stage: 'ci' })
  ];

  function ran(stage?: 'commit' | 'push' | 'ci'): string[] {
    return buildPlan(rules, context, stage).filter((item) => 'context' in item).map((item) => item.judge.id);
  }

  it('runs only the rules of its own stage at commit and at push', () => {
    expect(ran('commit')).toEqual(['commit-rule']);
    expect(ran('push')).toEqual(['push-rule']);
  });

  it('runs every rule at ci and without a stage', () => {
    expect(ran('ci')).toEqual(['commit-rule', 'push-rule', 'ci-rule']);
    expect(ran()).toEqual(['commit-rule', 'push-rule', 'ci-rule']);
  });

  it('skips a rule of another stage with a reason that starts with its stage', () => {
    const [, push] = buildPlan(rules, context, 'commit');

    expect(push).toEqual(expect.objectContaining({ skip: skipOtherStage(rules[1], 'commit') }));
    expect('skip' in push && push.skip).toMatch(/^stage push/);
  });

  it('reports the stage, not the scope, for a rule of another stage with no files in scope', () => {
    const [item] = buildPlan([judge({ stage: 'push', scope: ['docs/**'] })], context, 'commit');

    expect('skip' in item && item.skip).toMatch(/^stage push/);
  });
});

