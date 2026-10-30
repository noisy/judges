import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import colors from 'picocolors';
import { Judge, displayName } from './judges.js';
import {
  ExpectedLine, Fixture, FixtureExpect, FixtureVerdict, Verdict, blankExpectLines, findFixtures, judgeFixture
} from './fixtures.js';
import { readContents, walkDirectory } from './files.js';
import { buildPlan } from './plan.js';
import { runPlan } from './runner.js';
import { JudgeResult, SupportedEngine } from './types.js';

// A review result for one fixture, plus the fixture's verdict. `fixture` is null for a rule without fixtures.
export interface FixtureTestResult extends JudgeResult {
  fixture: string | null;
  expect: FixtureExpect | null;
  result: FixtureVerdict;
  reason?: string;
}

// One run per fixture, each in its own copy with only its rule; sorted by rule id, then fixture name.
// Fixtures sit next to rule files, so JUDGE.md judges are not tested.
export async function testRules(judges: Judge[], engine: SupportedEngine): Promise<FixtureTestResult[]> {
  const runs = judges.filter((judge) => judge.format === 'rule').flatMap((judge) => {
    const fixtures = findFixtures(judge);
    if (fixtures.length === 0) return [Promise.resolve(withoutFixtures(judge))];
    return fixtures.map((fixture) => testFixture(judge, fixture, engine));
  });
  return (await Promise.all(runs)).sort(byRuleThenFixture);
}

export function testExitCode(entries: FixtureTestResult[]): number {
  return entries.some((entry) => entry.result === 'failed') ? 1 : 0;
}

export function formatTestResults(entries: FixtureTestResult[]): string {
  const counts = (['passed', 'failed', 'skipped'] as const)
    .map((result) => `${entries.filter((entry) => entry.result === result).length} ${result}`);
  return [...entries.map(formatEntry), '', counts.join(', ')].join('\n');
}

async function testFixture(judge: Judge, fixture: Fixture, engine: SupportedEngine): Promise<FixtureTestResult> {
  if (!fixture.expect) {
    const reason = `bad-name: "${fixture.name}" is not violation, violation-<name>, pass or pass-<name>; rename the directory`;
    return entry(notRun(judge), fixture.name, null, { result: 'failed', reason });
  }

  // The copy keeps the fixture itself safe from the rule and from the blanking.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-fixture-')));
  try {
    fs.cpSync(fixture.dir, root, { recursive: true });
    const files = walkDirectory(root);
    const expected = blankExpectLinesIn(root, files, judge.id);
    const context = { ...readContents(files, root), root };
    const [run] = await runPlan(buildPlan([judge], context), engine);
    return entry(run, fixture.name, fixture.expect, judgeFixture(fixture.expect, expected, run));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Rewrites the copy in place and returns the lines the fixture expects findings on, relative to its root.
function blankExpectLinesIn(root: string, files: string[], ruleId: string): ExpectedLine[] {
  return files.flatMap((file) => {
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.includes('rule-expect')) return [];
    const blanked = blankExpectLines(path.relative(root, file), content, ruleId);
    fs.writeFileSync(file, blanked.content);
    return blanked.expected;
  });
}

function withoutFixtures(judge: Judge): FixtureTestResult {
  const reason = `no fixtures: add a violation and a pass directory under ${judge.id}.fixtures/ next to the rule`;
  return entry(notRun(judge), null, null, { result: 'skipped', reason });
}

function notRun(judge: Judge): JudgeResult {
  return { judgeId: judge.id, displayName: displayName(judge), file: judge.filePath, status: 'skipped', issues: [], durationMs: 0 };
}

// The verdict comes first after the id, so it reads first in the JSON.
function entry(run: JudgeResult, fixture: string | null, expect: FixtureExpect | null, verdict: Verdict): FixtureTestResult {
  const { judgeId, ...ran } = run;
  return { judgeId, fixture, expect, ...verdict, ...ran };
}

function byRuleThenFixture(a: FixtureTestResult, b: FixtureTestResult): number {
  return compare(a.judgeId, b.judgeId) || compare(a.fixture ?? '', b.fixture ?? '');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatEntry(entry: FixtureTestResult): string {
  const name = entry.fixture === null ? entry.judgeId : `${entry.judgeId}/${entry.fixture}`;
  if (entry.result === 'passed') return colors.green(`✔ ${name}`);
  if (entry.result === 'skipped') return colors.dim(`○ ${name}: skipped (${entry.reason})`);
  return colors.red(`✘ ${name}: ${entry.reason}`);
}
