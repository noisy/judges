import * as fs from 'fs';
import * as path from 'path';
import { Judge } from './judges.js';
import { parseLineRange, samePath } from './markers.js';
import { splitDiffByFile } from './scope.js';
import { repoRoot } from './files.js';
import { EvaluationContext, Issue, JudgeResult } from './types.js';

export type FixtureExpect = 'violation' | 'pass';
export type FixtureVerdict = 'passed' | 'failed' | 'skipped';

export interface Fixture {
  name: string;
  dir: string;
  expect?: FixtureExpect; // unset when the name is neither violation[-*] nor pass[-*]
}

export interface ExpectedLine {
  file: string;
  line: number;
}

export interface Verdict {
  result: FixtureVerdict;
  reason?: string;
}

const FIXTURES_SUFFIX = '.fixtures';
const FIXTURE_NAME = /^(violation|pass)(-.+)?$/;
// The comment syntax of markers (markers.ts), with its own keyword so the marker audit never sees it.
const EXPECT_LINE = /^\s*(?:#|\/\/|--|\/\*+|<!--|;+)\s*rule-expect:\s*([A-Za-z0-9][\w.-]*)/;
const ANY_MARKER_LINE = /^\s*(?:#|\/\/|--|\/\*+|<!--|;+)\s*rule-(?:expect|exception|debt|ignore|todo):/;
const PASSED: Verdict = { result: 'passed' };

export function fixturesDir(judge: Judge): string {
  return path.join(path.dirname(judge.filePath), `${judge.id}${FIXTURES_SUFFIX}`);
}

// Each directory inside `<id>.fixtures/` is one fixture; files next to them, like a README, are not.
export function findFixtures(judge: Judge): Fixture[] {
  const dir = fixturesDir(judge);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: path.join(dir, entry.name), expect: expectFromName(entry.name) }));
}

export function expectFromName(name: string): FixtureExpect | undefined {
  return FIXTURE_NAME.exec(name)?.[1] as FixtureExpect | undefined;
}

// Every rule-expect line becomes empty, so the rule never sees one and the other lines keep their numbers.
// An expectation points at the next line that is neither blank nor another marker.
export function blankExpectLines(file: string, content: string, ruleId: string): { content: string; expected: ExpectedLine[] } {
  const lines = content.split('\n');
  const expected = lines.flatMap((line, index) =>
    EXPECT_LINE.exec(line)?.[1] === ruleId ? [{ file, line: nextCodeLine(lines, index) }] : []);
  const blanked = lines.map((line) => (EXPECT_LINE.test(line) ? blankLine(line) : line));
  return { content: blanked.join('\n'), expected };
}

function nextCodeLine(lines: string[], markerIndex: number): number {
  let index = markerIndex + 1;
  while (index < lines.length && (ANY_MARKER_LINE.test(lines[index]) || lines[index].trim() === '')) index++;
  return index + 1;
}

// A CRLF file keeps its line ending, so only the comment goes.
function blankLine(line: string): string {
  return line.endsWith('\r') ? '\r' : '';
}

// A finding count alone proves nothing: the rule must have run, and its findings must sit on the marked lines.
export function judgeFixture(expect: FixtureExpect, expected: ExpectedLine[], run: JudgeResult): Verdict {
  if (run.status !== 'ok') return failed('did-not-run', `the rule ended with status ${run.status}${detail(run)}`);
  if (expect === 'pass') {
    if (run.issues.length === 0) return PASSED;
    return failed('false-positive', `expected no finding, got ${run.issues.length}: ${run.issues.map(issueLocation).join(', ')}`);
  }
  if (run.issues.length === 0) return failed('missed', 'expected at least one finding, got none');
  return expected.length === 0 ? PASSED : lineVerdict(expected, run.issues);
}

function lineVerdict(expected: ExpectedLine[], issues: Issue[]): Verdict {
  const unfound = expected.filter((mark) => !issues.some((issue) => isOnLine(issue, mark)));
  const unmarked = issues.filter((issue) => !expected.some((mark) => isOnLine(issue, mark)));
  if (unfound.length === 0 && unmarked.length === 0) return PASSED;

  const problems = [
    unfound.length > 0 ? `no finding on the marked line ${unfound.map(markLocation).join(', ')}` : '',
    unmarked.length > 0 ? `a finding on the unmarked line ${unmarked.map(issueLocation).join(', ')}` : '',
  ];
  return failed('wrong-line', problems.filter(Boolean).join('; '));
}

// A finding over a range is on every line of it.
function isOnLine(issue: Issue, mark: ExpectedLine): boolean {
  const range = parseLineRange(issue.line);
  return samePath(issue.file, mark.file) && range !== null && range.from <= mark.line && mark.line <= range.to;
}

function detail(run: JudgeResult): string {
  const text = run.skipReason ?? run.error?.split('\n')[0];
  return text ? ` (${text})` : '';
}

function failed(code: string, sentence: string): Verdict {
  return { result: 'failed', reason: `${code}: ${sentence}` };
}

function markLocation(mark: ExpectedLine): string {
  return `${mark.file}:${mark.line}`;
}

function issueLocation(issue: Issue): string {
  return `${issue.file}:${issue.line}`;
}

// A rule's fixtures break it on purpose, so a review leaves them out, whatever the rule's scope says.
export function withoutRuleFixtures(context: EvaluationContext, judges: Judge[]): EvaluationContext {
  const root = realPath(context.root ?? repoRoot());
  const dirs = judges.filter((judge) => judge.format === 'rule')
    .map((judge) => path.relative(root, realFixturesDir(judge)));
  const isFixtureFile = (file: string) => dirs.some((dir) => isInside(file, dir));

  const files = context.files.filter((file) => !isFixtureFile(file.path));
  if (context.rawDiff === undefined) return { ...context, files };

  const rawDiff = splitDiffByFile(context.rawDiff)
    .filter((section) => !isFixtureFile(section.path))
    .map((section) => section.text)
    .join('');
  return { ...context, rawDiff, files };
}

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Git reports the real root (/tmp is /private/tmp on macOS), so the rule's directory is resolved the same way.
// The rule file exists, so this works even when a change deletes the fixtures from the working tree.
function realFixturesDir(judge: Judge): string {
  return path.join(realPath(path.dirname(judge.filePath)), path.basename(fixturesDir(judge)));
}

function realPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}
