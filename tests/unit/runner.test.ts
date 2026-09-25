import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlan, buildEngineRequest, attributeToRule } from '../../src/runner.js';
import { getEngine, Engine, TimeoutError } from '../../src/engines/index.js';
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

  it('runs the engine in the repository root of the context', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    await runPlan([{ judge, context: { ...inputContext, root: '/fixture-repo' }, markers: [] }], 'claude');

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/fixture-repo' }));
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

  it('maps a timeout to status timeout without issues', async () => {
    run.mockRejectedValue(new TimeoutError('claude CLI timed out after 30 seconds.'));

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('timeout');
    expect(result.issues).toEqual([]);
    expect(result.error).toContain('timed out');
  });

  it('maps a generic error to status error without issues', async () => {
    run.mockRejectedValue(new Error('claude CLI not found on PATH'));

    const [result] = await runPlan([planned()], 'claude');

    expect(result.status).toBe('error');
    expect(result.issues).toEqual([]);
    expect(result.error).toBe('claude CLI not found on PATH');
  });
});

describe('runPlan with markers', () => {
  const marker: Marker = { kind: 'ignore', ruleId: 'srp', reason: 'external schema', file: 'a.ts', markerLine: 1, scope: { line: 2 } };

  beforeEach(() => {
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  it('drops findings on marked lines and counts them as suppressed', async () => {
    const issues = [
      { file: 'a.ts', line: 2, severity: 'high', message: 'marked' },
      { file: 'a.ts', line: 3, severity: 'low', message: 'not marked' }
    ];
    run.mockResolvedValue({ rawOutput: JSON.stringify(issues), durationMs: 5 });

    const [result] = await runPlan([planned([marker])], 'claude');

    expect(result.issues.map((i) => i.message)).toEqual(['not marked']);
    expect(result.suppressed).toBe(1);
  });

  it('reports zero suppressed when nothing is marked', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    const [result] = await runPlan([planned()], 'claude');

    expect(result.suppressed).toBe(0);
  });

  it('tells the judge which places are accounted for', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });

    await runPlan([planned([marker])], 'claude');

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).toContain('Markers (accounted for, do not report');
    expect(prompt).toContain('- a.ts:2 (rule-ignore): external schema');
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

  it('keeps plan order when skipped and executed judges are mixed', async () => {
    run.mockResolvedValue({ rawOutput: '[]', durationMs: 5 });
    const skippedJudge = { ...judge, id: 'deterministic-one' } as Judge;

    const results = await runPlan([{ judge: skippedJudge, skip: 'x' }, planned()], 'claude');

    expect(results.map((r) => [r.judgeId, r.status])).toEqual([['deterministic-one', 'skipped'], ['srp', 'ok']]);
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
      timeoutMs: 45000,
      maxBudgetUsd: undefined,
      tools: [],
      allowRead: [],
      maxTurns: undefined
    });
  });

  it('maps the judge engine options onto the request', () => {
    const judge = { mode: 'agent', timeout_seconds: 60, model: 'small', tools: ['Read'], allow_read: ['../billing/**'], max_budget_usd: 0.5, max_turns: 4 } as Judge;

    expect(buildEngineRequest(judge, 'prompt', '/repo')).toEqual({
      prompt: 'prompt',
      mode: 'agent',
      cwd: '/repo',
      model: 'small',
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
