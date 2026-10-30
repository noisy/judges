import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlan, buildEngineRequest, attributeToRule } from '../../src/runner.js';
import { getEngine, Engine, EngineStoppedError } from '../../src/engines/index.js';
import { Judge } from '../../src/judges.js';
import { PlanItem } from '../../src/plan.js';
import { Marker } from '../../src/markers.js';
import { EvaluationContext, JudgeEvent } from '../../src/types.js';

vi.mock('../../src/engines/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engines/index.js')>();
  return { ...original, getEngine: vi.fn() };
});

const run = vi.fn<Engine['run']>();

const inputContext: EvaluationContext = { type: 'files', files: [{ path: 'a.ts', content: 'x' }] };

const judge = {
  id: 'srp',
  name: 'SRP Validator',
  instructions: 'Check SRP.',
  mode: 'one-shot',
  timeout_seconds: 30,
  tools: [],
  filePath: '/judges/srp/JUDGE.md'
} as unknown as Judge;

function planned(markers: Marker[] = []): PlanItem {
  return { judge, context: inputContext, markers };
}

describe('runPlan outcome mapping', () => {
  beforeEach(() => {
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  it('maps a successful run to status ok with issues sorted by severity', async () => {
    const issues = [
      { file: 'a.ts', line: 1, severity: 'low', message: 'minor' },
      { file: 'a.ts', line: 2, severity: 'high', message: 'major' }
    ];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), costUsd: 0.01, turns: 1, durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('ok');
    expect(result.judgeId).toBe('srp');
    expect(result.displayName).toBe('SRP Validator');
    expect(result.file).toBe('/judges/srp/JUDGE.md');
    expect(result.issues.map(i => i.severity)).toEqual(['high', 'low']);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.costUsd).toBe(0.01);
    expect(result.turns).toBe(1);
  });

  it('runs the engine with the request built from the judge', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    await runPlan([planned()], 'claude');

    expect(getEngine).toHaveBeenCalledWith('claude');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30000, tools: [] }));
  });

  it('records the effort the rule ran with, and none when the rule sets none', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });
    const thorough = { ...judge, id: 'thorough', effort: 'max' } as Judge;

    const results = await runPlan([planned(), { judge: thorough, context: inputContext, markers: [] }], 'claude');

    expect(results.map((r) => [r.judgeId, r.effort])).toEqual([['srp', undefined], ['thorough', 'max']]);
  });

  it('runs the engine in the repository root of the context', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    await runPlan([{ judge, context: { ...inputContext, root: '/fixture-repo' }, markers: [] }], 'claude');

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/fixture-repo' }));
  });

  it('records which files the judge was given in the prompt', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });
    const context: EvaluationContext = { type: 'files', files: [{ path: 'src/a.py', content: 'x' }, { path: 'src/b.py', content: 'y' }] };

    const [result] = await runPlan([{ judge, context, markers: [] }], 'claude');

    expect(result.inline).toEqual(['src/a.py', 'src/b.py']);
  });

  it('keeps what an agent judge examined in the result', async () => {
    const examined = [{ tool: 'Read', target: 'tests/test_a.py' }];
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5, examined });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.examined).toEqual(examined);
  });

  it('maps unparseable engine output to status error', async () => {
    run.mockResolvedValue({ rawOutput: 'not json', durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('error');
    expect(result.error).toContain('Failed to parse LLM output');
  });

  it('maps a run killed on its time limit to stopped on time, with one turn and an unknown cost', async () => {
    run.mockRejectedValue(new EngineStoppedError('claude CLI timed out after 30 seconds.', {}, 'time'));

    const [result] = await runPlan([planned()], 'claude');

    expect(result).toMatchObject({ status: 'stopped', stopReason: 'time', issues: [], turns: 1, costUsd: null,
      error: 'claude CLI timed out after 30 seconds.' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps the turns an agent took before its time stop', async () => {
    run.mockRejectedValue(new EngineStoppedError('claude CLI timed out after 1 seconds.', { turns: 2 }, 'time'));

    const [result] = await runPlan([{ ...planned(), judge: { ...judge, mode: 'agent' } as Judge }], 'claude');

    expect(result).toMatchObject({ status: 'stopped', stopReason: 'time', turns: 2, costUsd: null });
  });

  it('records the cost as unknown and one turn for a one-shot run whose engine says neither', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result).toMatchObject({ status: 'ok', turns: 1, costUsd: null });
  });

  it('maps a generic error to status error without issues', async () => {
    run.mockRejectedValue(new Error('claude CLI not found on PATH'));

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('error');
    expect(result.issues).toEqual([]);
    expect(result.error).toBe('claude CLI not found on PATH');
  });

  it('keeps the cost, turns and examined targets of a run stopped on a limit', async () => {
    const usage = { costUsd: 0.034, turns: 2, examined: [{ tool: 'Read', target: 'tests/test_greet.py' }] };
    run.mockRejectedValue(new EngineStoppedError('claude CLI stopped: turn limit reached (2)', usage, 'turns'));

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('stopped');
    expect(result.stopReason).toBe('turns');
    expect(result.error).toBe('claude CLI stopped: turn limit reached (2)');
    expect(result).toMatchObject({ ...usage, inline: ['a.ts'] });
  });

  it('keeps an error the engine reported as an error, with what it spent', async () => {
    run.mockRejectedValue(new EngineStoppedError('claude CLI stopped: boom', { costUsd: 0.01, turns: 1 }));

    const [result] = await runPlan([planned()], 'claude');

    expect(result).toMatchObject({ status: 'error', costUsd: 0.01, turns: 1 });
    expect(result.stopReason).toBeUndefined();
  });
});

describe('runPlan with markers', () => {
  const marker: Marker = { kind: 'exception', ruleId: 'srp', reason: 'external schema', file: 'a.ts', markerLine: 1 };

  beforeEach(() => {
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  it('drops the findings the judge gives to a marker, and lists and counts them as covered', async () => {
    const issues = [
      { file: 'a.ts', line: 9, severity: 'high', message: 'covered far below', covered_by: './a.ts:1' },
      { file: 'a.ts', line: 2, severity: 'low', message: 'right below, not covered' }
    ];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned([marker])], 'claude');

    expect(result.issues.map((i) => i.message)).toEqual(['right below, not covered']);
    expect(result.covered).toEqual([{ file: 'a.ts', line: 9, severity: 'high', message: 'covered far below', covered_by: 'a.ts:1' }]);
    expect(result.suppressed).toBe(1);
  });

  it('reports a finding whose covered_by names no marker of the prompt, without the covered_by', async () => {
    const issues = [
      { file: 'a.ts', line: 3, severity: 'low', message: 'points at a line with no marker', covered_by: 'a.ts:2' },
      { file: 'a.ts', line: 4, severity: 'low', message: 'points at nothing', covered_by: 'the marker above' }
    ];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned([marker])], 'claude');

    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((issue) => !('covered_by' in issue))).toBe(true);
    expect(result.covered).toEqual([]);
    expect(result.suppressed).toBe(0);
  });

  it('keeps a covered finding the judge words as accepted, instead of dismissing it', async () => {
    const issues = [{ file: 'a.ts', line: 2, severity: 'low', message: 'Accepted by the marker, no issue here.', covered_by: 'a.ts:1' }];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned([marker])], 'claude');

    expect(result.covered).toHaveLength(1);
    expect(result.dismissed).toBe(0);
  });

  it('drops entries that say the code follows the rule and counts them as dismissed', async () => {
    const issues = [
      { file: 'a.ts', line: 2, severity: 'low', message: 'The comment explains why. No issue here.' },
      { file: 'a.ts', line: 3, severity: 'low', message: 'The comment restates the code.' }
    ];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.issues.map((i) => i.message)).toEqual(['The comment restates the code.']);
    expect(result.dismissed).toBe(1);
  });

  it('reports zero suppressed when nothing is marked', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.suppressed).toBe(0);
  });

  it('tells the judge about its markers, at their own lines', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    await runPlan([planned([marker])], 'claude');

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).toContain('- a.ts:1 (rule-exception): external schema');
    expect(prompt).toContain('"covered_by"');
  });
});

describe('runPlan on a diff', () => {
  // a.ts gains line 3; lines 1 and 2 are old.
  const diffContext: EvaluationContext = {
    type: 'diff',
    rawDiff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n one\n two\n+three\n',
    files: [{ path: 'a.ts', content: 'one\ntwo\nthree\n' }]
  };
  const issues = [
    { file: 'a.ts', line: 1, severity: 'low', message: 'old' },
    { file: 'a.ts', line: 3, severity: 'low', message: 'new' }
  ];

  beforeEach(() => {
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  it('drops one-shot findings outside the added lines and counts them apart', async () => {
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([{ judge, context: diffContext, markers: [] }], 'claude');

    expect(result.issues.map((i) => i.message)).toEqual(['new']);
    expect(result.outsideDiff).toBe(1);
    expect(result.suppressed).toBe(0);
  });

  it('counts a finding once, as suppressed, when a marker covers it outside the diff', async () => {
    const marker: Marker = { kind: 'debt', ruleId: 'srp', reason: 'known', file: 'a.ts', markerLine: 2 };
    const answer = [{ ...issues[0], covered_by: 'a.ts:2' }, issues[1]];
    run.mockResolvedValue({ rawOutput: JSON.stringify(answer), durationMs: 5 });

    const [result] = await runPlan([{ judge, context: diffContext, markers: [marker] }], 'claude');

    expect(result.suppressed).toBe(1);
    expect(result.outsideDiff).toBe(0);
  });

  it('keeps agent findings outside the diff: a change may break an untouched caller', async () => {
    const agent = { ...judge, mode: 'agent' } as Judge;
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([{ judge: agent, context: diffContext, markers: [] }], 'claude');

    expect(result.issues).toHaveLength(2);
    expect(result.outsideDiff).toBeUndefined();
  });

  it('keeps every finding with paths as input, where there is no diff', async () => {
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.issues).toHaveLength(2);
    expect(result.outsideDiff).toBeUndefined();
  });
});

describe('runPlan progress and skips', () => {
  beforeEach(() => {
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  it('emits running then done with the result for an executed judge', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });
    const events: JudgeEvent[] = [];

    const [result] = await runPlan([planned()], 'claude', (event) => events.push(event));

    expect(events).toEqual([
      { judgeId: 'srp', state: 'running' },
      { judgeId: 'srp', state: 'done', result }
    ]);
  });

  it('returns a skipped result without calling the engine', async () => {
    const events: JudgeEvent[] = [];

    const [result] = await runPlan([{ judge, skip: 'no files in scope' }], 'claude', (event) => events.push(event));

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      judgeId: 'srp',
      status: 'skipped',
      skipReason: 'no files in scope',
      issues: []
    }));
    expect(events).toEqual([{ judgeId: 'srp', state: 'done', result }]);
  });

  it('returns an error result for an invalid rule without calling the engine', async () => {
    const [result] = await runPlan([{ judge, invalid: 'invalid rule: severity: unknown value' }], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      judgeId: 'srp',
      status: 'error',
      error: 'invalid rule: severity: unknown value',
      issues: []
    }));
  });

  it('keeps plan order when skipped and executed judges are mixed', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });
    const skippedJudge = { ...judge, id: 'out-of-scope' } as Judge;

    const results = await runPlan([{ judge: skippedJudge, skip: 'x' }, planned()], 'claude');

    expect(results.map((r) => [r.judgeId, r.status])).toEqual([['out-of-scope', 'skipped'], ['srp', 'ok']]);
  });
});

describe('buildEngineRequest', () => {
  it('builds a one-shot request with the engine default model when the judge sets no engine options', () => {
    const judge = { timeout_seconds: 45, tools: [] as string[] } as Judge;

    expect(buildEngineRequest(judge, 'prompt')).toEqual({
      prompt: 'prompt',
      mode: undefined,
      cwd: undefined,
      model: undefined,
      effort: undefined,
      timeoutMs: 45000,
      maxBudgetUsd: undefined,
      tools: [],
      allowRead: [],
      maxTurns: undefined
    });
  });

  it('maps the judge engine options onto the request', () => {
    const judge = { mode: 'agent', timeout_seconds: 60, model: 'small', effort: 'high', tools: ['Read'], allow_read: ['../billing/**'], max_budget_usd: 0.5, max_turns: 4 } as Judge;

    expect(buildEngineRequest(judge, 'prompt', '/repo')).toEqual({
      prompt: 'prompt',
      mode: 'agent',
      cwd: '/repo',
      model: 'small',
      effort: 'high',
      timeoutMs: 60000,
      maxBudgetUsd: 0.5,
      tools: ['Read'],
      allowRead: ['../billing/**'],
      maxTurns: 4
    });
  });
});

describe('attributeToRule', () => {
  const issues = [{ file: 'a.ts', line: 1, severity: 'medium' as const, message: 'msg', rule_id: 'made-up' }];

  it('stamps rule issues with the rule id and the rule severity', () => {
    const rule = { id: 'booleans-read-as-questions', format: 'rule', severity: 'low' } as Judge;

    expect(attributeToRule(rule, issues)).toEqual([
      { file: 'a.ts', line: 1, severity: 'low', message: 'msg', rule_id: 'booleans-read-as-questions' }
    ]);
  });

  it('keeps the model severity for legacy JUDGE.md judges', () => {
    const legacy = { id: 'srp', format: 'judge-md', severity: 'low' } as Judge;

    expect(attributeToRule(legacy, issues)).toEqual(issues);
  });

  it('applies the rule severity to engine results', async () => {
    const rule = { ...judge, format: 'rule', severity: 'high' } as Judge;
    run.mockReset();
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });

    const [result] = await runPlan([{ judge: rule, context: inputContext, markers: [] }], 'claude');

    expect(result.issues[0]).toEqual(expect.objectContaining({ severity: 'high', rule_id: 'srp' }));
  });
});
