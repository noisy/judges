import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import colors from 'picocolors';
import { Judge } from './judges.js';
import { FoundTest, InvalidTest, Mode, RuleTest, findTests, modeOf } from './rule-test-spec.js';
import { prepareCode } from './rule-test-code.js';
import { Verdict, invalidVerdict, judgeTest } from './rule-test-verdict.js';
import { buildPlan } from './plan.js';
import { runPlan } from './runner.js';
import { Issue, JudgeResult, SupportedEngine } from './types.js';

// How the rule ran on a test: a review result without the rule's identity and its findings.
export type TestRun = Omit<JudgeResult, 'judgeId' | 'displayName' | 'file' | 'issues'>;

// One entry per test. `test` is null for a rule without tests; `run` is null when the rule did not run.
export interface TestEntry {
  rule: string;
  test: string | null;
  mode: Mode | null;
  status: 'passed' | 'failed' | 'skipped';
  reason: string | null;
  findings: Issue[];
  run: TestRun | null;
}

const NO_TESTS = 'no tests';

// One run per test, each in its own temporary copy with only its rule; sorted by rule id, then test name.
// Tests live in rule directories, so JUDGE.md judges are not tested.
export async function testRules(judges: Judge[], engine: SupportedEngine): Promise<TestEntry[]> {
  const runs = judges.filter((judge) => judge.format === 'rule').flatMap((judge) => {
    const tests = findTests(judge);
    if (tests.length === 0) return [Promise.resolve(withoutTests(judge))];
    return tests.map((test) => runTest(judge, test, engine));
  });
  return (await Promise.all(runs)).sort(byRuleThenTest);
}

export function testExitCode(entries: TestEntry[]): number {
  return entries.some((entry) => entry.status === 'failed') ? 1 : 0;
}

export function formatTestResults(entries: TestEntry[]): string {
  const counts = (['passed', 'failed', 'skipped'] as const)
    .map((status) => `${entries.filter((entry) => entry.status === status).length} ${status}`);
  return [...entries.map(formatEntry), '', counts.join(', ')].join('\n');
}

// A broken test fails without a model call: skipping it would look the same as passing.
async function runTest(judge: Judge, found: FoundTest, engine: SupportedEngine): Promise<TestEntry> {
  let test: RuleTest;
  try {
    test = found.read();
  } catch (error) {
    return invalidEntry(judge, found.name, error);
  }

  // The copy keeps the test's files safe from the rule; the index of a history checkout sits next to it.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-test-')));
  try {
    const root = path.join(workspace, 'repo');
    fs.mkdirSync(root);
    const [run] = await runPlan(buildPlan([judge], prepareCode(test.code, root)), engine);
    return entry(judge.id, test.name, modeOf(test.code), judgeTest(test.expected, run), run);
  } catch (error) {
    return invalidEntry(judge, found.name, error);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function invalidEntry(judge: Judge, name: string, error: unknown): TestEntry {
  if (!(error instanceof InvalidTest)) throw error;
  return entry(judge.id, name, null, invalidVerdict(error.message));
}

function withoutTests(judge: Judge): TestEntry {
  return { rule: judge.id, test: null, mode: null, status: 'skipped', reason: NO_TESTS, findings: [], run: null };
}

function entry(rule: string, test: string, mode: Mode | null, verdict: Verdict, run?: JudgeResult): TestEntry {
  return { rule, test, mode, ...verdict, findings: run?.issues ?? [], run: run ? runRecord(run) : null };
}

function runRecord({ judgeId, displayName, file, issues, ...run }: JudgeResult): TestRun {
  return run;
}

function byRuleThenTest(a: TestEntry, b: TestEntry): number {
  return compare(a.rule, b.rule) || compare(a.test ?? '', b.test ?? '');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatEntry(entry: TestEntry): string {
  if (entry.test === null) return colors.dim(`○ ${entry.rule}: skipped (${entry.reason})`);
  const name = `${entry.rule}/${entry.test}${entry.mode ? ` (${entry.mode})` : ''}`;
  if (entry.status === 'passed') return colors.green(`✔ ${name}`);
  return colors.red(`✘ ${name}: ${entry.reason}`);
}
