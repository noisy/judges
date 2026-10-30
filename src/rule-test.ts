import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import colors from 'picocolors';
import { Judge } from './judges.js';
import { FoundTest, InvalidTest, Mode, RuleTest, findTests, modeOf } from './rule-test-spec.js';
import { prepareCode } from './rule-test-code.js';
import { Verdict, invalidVerdict, judgeTest } from './rule-test-verdict.js';
import { Calibration, NO_CONFIDENCES, TestConfidences, calibrationOf, describeCalibration, testConfidences }
  from './rule-test-calibration.js';
import { buildPlan } from './plan.js';
import { runPlan } from './runner.js';
import { calledModel, runTotals } from './run-totals.js';
import { formatCostLine } from './format.js';
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

// After the tests of a rule: where a `min_confidence` would work for it. It has no `test`.
export interface CalibrationEntry {
  rule: string;
  calibration: Calibration;
}

export type TestReportEntry = TestEntry | CalibrationEntry;

// A test entry with the confidences of its findings, which only the calibration reads.
interface TestOutcome {
  entry: TestEntry;
  confidences: TestConfidences;
}

const NO_TESTS = 'no tests';

// One run per test, each in its own temporary copy with only its rule. Sorted by rule id, each rule's tests by name
// and then its calibration. Tests live in rule directories, so JUDGE.md judges are not tested.
export async function testRules(judges: Judge[], engine: SupportedEngine): Promise<TestReportEntry[]> {
  const rules = judges.filter((judge) => judge.format === 'rule').sort((a, b) => compare(a.id, b.id));
  return (await Promise.all(rules.map((judge) => testRule(judge, engine)))).flat();
}

export function testExitCode(entries: TestReportEntry[]): number {
  return testEntries(entries).some((entry) => entry.status === 'failed') ? 1 : 0;
}

export function formatTestResults(entries: TestReportEntry[]): string {
  const tests = testEntries(entries);
  const counts = (['passed', 'failed', 'skipped'] as const)
    .map((status) => `${tests.filter((entry) => entry.status === status).length} ${status}`);
  const runs = tests.flatMap((entry) => (entry.run ? [entry.run] : []));
  const costLine = runs.some(calledModel) ? ['', formatCostLine(runTotals(runs))] : [];
  return [...entries.map(formatEntry), '', counts.join(', '), ...costLine].join('\n');
}

async function testRule(judge: Judge, engine: SupportedEngine): Promise<TestReportEntry[]> {
  const tests = findTests(judge);
  if (tests.length === 0) return [withoutTests(judge)];
  const outcomes = await Promise.all(tests.map((test) => runTest(judge, test, engine)));
  const entries = outcomes.map((outcome) => outcome.entry).sort((a, b) => compare(a.test ?? '', b.test ?? ''));
  return [...entries, { rule: judge.id, calibration: calibrationOf(outcomes.map((outcome) => outcome.confidences)) }];
}

function testEntries(entries: TestReportEntry[]): TestEntry[] {
  return entries.filter((entry): entry is TestEntry => 'status' in entry);
}

// A broken test fails without a model call: skipping it would look the same as passing.
async function runTest(judge: Judge, found: FoundTest, engine: SupportedEngine): Promise<TestOutcome> {
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
    return {
      entry: entry(judge.id, test.name, modeOf(test.code), judgeTest(test.expected, run), run),
      confidences: testConfidences(test.expected, run),
    };
  } catch (error) {
    return invalidEntry(judge, found.name, error);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function invalidEntry(judge: Judge, name: string, error: unknown): TestOutcome {
  if (!(error instanceof InvalidTest)) throw error;
  return { entry: entry(judge.id, name, null, invalidVerdict(error.message)), confidences: NO_CONFIDENCES };
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatEntry(entry: TestReportEntry): string {
  if ('calibration' in entry) return `${entry.rule}: ${describeCalibration(entry.calibration)}`;
  if (entry.test === null) return colors.dim(`○ ${entry.rule}: skipped (${entry.reason})`);
  const name = `${entry.rule}/${entry.test}${entry.mode ? ` (${entry.mode})` : ''}`;
  if (entry.status === 'passed') return colors.green(`✔ ${name}`);
  return colors.red(`✘ ${name}: ${entry.reason}`);
}
