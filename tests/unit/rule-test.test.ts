import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { testRules, testExitCode, formatTestResults, FixtureTestResult } from '../../src/rule-test.js';
import { getEngine, Engine } from '../../src/engines/index.js';
import { defaultSettings } from '../../src/validator.js';
import { Judge } from '../../src/judges.js';

vi.mock('../../src/engines/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/engines/index.js')>();
  return { ...original, getEngine: vi.fn() };
});

const run = vi.fn<Engine['run']>();
let rulesDir: string;

function writeFile(relativePath: string, content: string): string {
  const filePath = path.join(rulesDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function rule(id: string, overrides: Partial<Judge> = {}): Judge {
  return {
    ...defaultSettings(), id, name: id, format: 'rule', instructions: `Rule ${id}.`, scope: ['src/**/*.py'],
    filePath: path.join(rulesDir, `${id}.md`), isValid: true, validationErrors: [], ...overrides
  } as Judge;
}

function replyWith(findings: object[]): Promise<{ rawOutput: string; durationMs: number }> {
  return Promise.resolve({ rawOutput: JSON.stringify(findings), durationMs: 1 });
}

describe('testRules', () => {
  beforeEach(() => {
    rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-rule-test-'));
    run.mockReset();
    vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
  });

  afterEach(() => {
    fs.rmSync(rulesDir, { recursive: true, force: true });
  });

  it('reviews each fixture whole, alone, with paths relative to the fixture root', async () => {
    writeFile('no-print.fixtures/violation/src/billing/report.py', 'def render():\n    print(1)\n');
    writeFile('no-print.fixtures/pass/src/app.py', 'logger.info(1)\n');
    run.mockImplementation((request) => replyWith(request.prompt.includes('print(1)')
      ? [{ file: 'src/billing/report.py', line: 2, severity: 'low', message: 'print call' }]
      : []));

    const entries = await testRules([rule('no-print')], 'claude');

    expect(run).toHaveBeenCalledTimes(2);
    expect(entries.map(({ fixture, expect, result, status, inline }) => ({ fixture, expect, result, status, inline }))).toEqual([
      { fixture: 'pass', expect: 'pass', result: 'passed', status: 'ok', inline: ['src/app.py'] },
      { fixture: 'violation', expect: 'violation', result: 'passed', status: 'ok', inline: ['src/billing/report.py'] },
    ]);
    expect(entries[1].issues).toEqual([expect.objectContaining({ file: 'src/billing/report.py', line: 2, rule_id: 'no-print' })]);
  });

  it('hides rule-expect lines from the rule and leaves the fixture itself untouched', async () => {
    const original = 'def total(items):\n    # rule-expect: no-print\n    print(items)\n';
    const filePath = writeFile('no-print.fixtures/violation/src/app.py', original);
    run.mockImplementation(() => replyWith([{ file: 'src/app.py', line: 3, severity: 'low', message: 'print call' }]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    const prompt = run.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('rule-expect');
    expect(prompt).toContain('3| ' + '    print(items)');
    expect(entry.result).toBe('passed');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('reports a rule without fixtures as skipped and a misnamed fixture as failed, without running either', async () => {
    writeFile('no-print.fixtures/good/src/app.py', 'print(1)\n');

    const entries = await testRules([rule('no-print'), rule('comments-explain-why')], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entries.map(({ judgeId, fixture, result, reason }) => ({ judgeId, fixture, result, reason }))).toEqual([
      { judgeId: 'comments-explain-why', fixture: null, result: 'skipped', reason: expect.stringMatching(/^no fixtures: .* comments-explain-why\.fixtures\//) },
      { judgeId: 'no-print', fixture: 'good', result: 'failed', reason: expect.stringMatching(/^bad-name: "good" /) },
    ]);
  });

  it('leaves out JUDGE.md judges, which have no fixture layout', async () => {
    const legacy = rule('srp', { format: 'judge-md', filePath: path.join(rulesDir, 'srp', 'JUDGE.md') });

    expect(await testRules([legacy], 'claude')).toEqual([]);
  });

  it('runs the rule as in a review: a fixture with nothing in scope is skipped and does not pass', async () => {
    writeFile('no-print.fixtures/pass-docs/docs/usage.md', 'Set APP_PORT.\n');

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entry).toEqual(expect.objectContaining({ status: 'skipped', result: 'failed', reason: expect.stringMatching(/^did-not-run: /) }));
  });

  it('sorts by rule id, then by fixture name', async () => {
    for (const fixture of ['violation', 'pass-b', 'pass']) writeFile(`b-rule.fixtures/${fixture}/src/a.py`, 'x\n');
    writeFile('a-rule.fixtures/pass/src/a.py', 'x\n');
    run.mockImplementation(() => replyWith([]));

    const entries = await testRules([rule('b-rule'), rule('a-rule')], 'claude');

    expect(entries.map((entry) => `${entry.judgeId}/${entry.fixture}`)).toEqual([
      'a-rule/pass', 'b-rule/pass', 'b-rule/pass-b', 'b-rule/violation'
    ]);
  });
});

describe('the outcome of judge test', () => {
  function entry(overrides: Partial<FixtureTestResult>): FixtureTestResult {
    return {
      judgeId: 'no-print', fixture: 'pass', expect: 'pass', result: 'passed', displayName: 'no-print', file: '',
      status: 'ok', issues: [], durationMs: 1, ...overrides
    };
  }

  it('exits 1 only when a fixture failed; a rule without fixtures does not fail the run', () => {
    const skipped = entry({ fixture: null, expect: null, result: 'skipped', reason: 'no fixtures: add some' });

    expect(testExitCode([entry({}), skipped])).toBe(0);
    expect(testExitCode([entry({}), entry({ fixture: 'violation', result: 'failed', reason: 'missed: none' })])).toBe(1);
  });

  it('prints one line per fixture, then the counts', () => {
    const text = formatTestResults([
      entry({}),
      entry({ fixture: 'violation', expect: 'violation', result: 'failed', reason: 'missed: expected at least one finding, got none' }),
      entry({ judgeId: 'other', fixture: null, expect: null, result: 'skipped', reason: 'no fixtures: add some' }),
    ]);

    expect(text.split('\n').map((line) => line.replace(/\x1b\[\d+m/g, ''))).toEqual([
      '✔ no-print/pass',
      '✘ no-print/violation: missed: expected at least one finding, got none',
      '○ other: skipped (no fixtures: add some)',
      '',
      '1 passed, 1 failed, 1 skipped',
    ]);
  });
});
