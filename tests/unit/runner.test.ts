import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runJudgesParallel } from '../../src/runner.js';
import { executeLLM, TimeoutError } from '../../src/llm.js';
import { JudgeProgress } from '../../src/ui.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext } from '../../src/types.js';

vi.mock('../../src/llm.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/llm.js')>();
  return { ...original, executeLLM: vi.fn() };
});

const inputContext: EvaluationContext = { type: 'files', files: [{ path: 'a.ts', content: 'x' }] };

function makeProgress(): JudgeProgress {
  const judge = {
    id: 'srp',
    name: 'SRP Validator',
    instructions: 'Check SRP.',
    timeout_seconds: 30,
    filePath: '/judges/srp/JUDGE.md'
  } as Judge;
  return { judge, state: 'pending', displayName: judge.name };
}

describe('runJudgesParallel outcome mapping', () => {
  beforeEach(() => {
    vi.mocked(executeLLM).mockReset();
  });

  it('maps a successful run to status ok with issues sorted by severity', async () => {
    vi.mocked(executeLLM).mockResolvedValue([
      { file: 'a.ts', line: 1, severity: 'low', message: 'minor' },
      { file: 'a.ts', line: 2, severity: 'high', message: 'major' }
    ]);

    const [result] = await runJudgesParallel([makeProgress()], inputContext, 'claude');

    expect(result.status).toBe('ok');
    expect(result.judgeId).toBe('srp');
    expect(result.displayName).toBe('SRP Validator');
    expect(result.file).toBe('/judges/srp/JUDGE.md');
    expect(result.issues.map(i => i.severity)).toEqual(['high', 'low']);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps a timeout to status timeout without issues', async () => {
    vi.mocked(executeLLM).mockRejectedValue(new TimeoutError('claude CLI timed out after 30 seconds.'));
    const progress = makeProgress();

    const [result] = await runJudgesParallel([progress], inputContext, 'claude');

    expect(result.status).toBe('timeout');
    expect(result.issues).toEqual([]);
    expect(result.error).toContain('timed out');
    expect(progress.status).toBe('timeout');
  });

  it('maps a generic error to status error without issues', async () => {
    vi.mocked(executeLLM).mockRejectedValue(new Error('claude CLI not found on PATH'));
    const progress = makeProgress();

    const [result] = await runJudgesParallel([progress], inputContext, 'claude');

    expect(result.status).toBe('error');
    expect(result.issues).toEqual([]);
    expect(result.error).toBe('claude CLI not found on PATH');
    expect(progress.state).toBe('done');
    expect(progress.error).toBe('claude CLI not found on PATH');
  });
});
