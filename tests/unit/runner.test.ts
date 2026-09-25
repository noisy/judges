import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runJudgesParallel, buildEngineRequest } from '../../src/runner.js';
import { getEngine, Engine, TimeoutError } from '../../src/engines/index.js';
import { JudgeProgress } from '../../src/ui.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext } from '../../src/types.js';

vi.mock('../../src/engines/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engines/index.js')>();
  return { ...original, getEngine: vi.fn() };
});

const run = vi.fn<Engine['run']>();

const inputContext: EvaluationContext = { type: 'files', files: [{ path: 'a.ts', content: 'x' }] };

function makeProgress(): JudgeProgress {
  const judge = {
    id: 'srp',
    name: 'SRP Validator',
    instructions: 'Check SRP.',
    timeout_seconds: 30,
    tools: [],
    filePath: '/judges/srp/JUDGE.md'
  } as Judge;
  return { judge, state: 'pending', displayName: judge.name };
}

describe('runJudgesParallel outcome mapping', () => {
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

    const [result] = await runJudgesParallel([makeProgress()], inputContext, 'claude');

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

    await runJudgesParallel([makeProgress()], inputContext, 'claude');

    expect(getEngine).toHaveBeenCalledWith('claude');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30000, tools: [] }));
  });

  it('maps unparseable engine output to status error', async () => {
    run.mockResolvedValue({ rawOutput: 'not json', durationMs: 5 });

    const [result] = await runJudgesParallel([makeProgress()], inputContext, 'claude');

    expect(result.status).toBe('error');
    expect(result.error).toContain('Failed to parse LLM output');
  });

  it('maps a timeout to status timeout without issues', async () => {
    run.mockRejectedValue(new TimeoutError('claude CLI timed out after 30 seconds.'));
    const progress = makeProgress();

    const [result] = await runJudgesParallel([progress], inputContext, 'claude');

    expect(result.status).toBe('timeout');
    expect(result.issues).toEqual([]);
    expect(result.error).toContain('timed out');
    expect(progress.status).toBe('timeout');
  });

  it('maps a generic error to status error without issues', async () => {
    run.mockRejectedValue(new Error('claude CLI not found on PATH'));
    const progress = makeProgress();

    const [result] = await runJudgesParallel([progress], inputContext, 'claude');

    expect(result.status).toBe('error');
    expect(result.issues).toEqual([]);
    expect(result.error).toBe('claude CLI not found on PATH');
    expect(progress.state).toBe('done');
    expect(progress.error).toBe('claude CLI not found on PATH');
  });
});

describe('buildEngineRequest', () => {
  it('builds a one-shot request with the engine default model when the judge sets no engine options', () => {
    const judge = { timeout_seconds: 45, tools: [] as string[] } as Judge;

    expect(buildEngineRequest(judge, 'prompt')).toEqual({
      prompt: 'prompt',
      model: undefined,
      timeoutMs: 45000,
      maxBudgetUsd: undefined,
      tools: [],
      maxTurns: undefined
    });
  });

  it('maps the judge engine options onto the request', () => {
    const judge = { timeout_seconds: 60, model: 'small', tools: ['Read'], max_budget_usd: 0.5, max_turns: 4 } as Judge;

    expect(buildEngineRequest(judge, 'prompt')).toEqual({
      prompt: 'prompt',
      model: 'small',
      timeoutMs: 60000,
      maxBudgetUsd: 0.5,
      tools: ['Read'],
      maxTurns: 4
    });
  });
});
