import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { z } from 'zod';
import { Judge, ruleDirectory } from './judges.js';
import { repoRoot } from './files.js';
import { splitDiffByFile } from './scope.js';
import { EvaluationContext } from './types.js';

export const TESTS_DIR = 'tests';
const TEST_FILE = 'test.yaml';
const PATCH_FILE = 'change.patch';
const REPO_DIR = 'repo';
const SINGLE_FILE_EXTENSION = '.md';
const CHANGE_HEADING = 'change';
const HISTORY_FIELDS = ['base', 'head', 'commit'] as const;

const HEADING = /^##[ \t]+(.*?)[ \t]*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})[ \t]*([^\s`]*)/;

export type Mode = 'review' | 'audit';

export interface LineSpan {
  from: number;
  to: number;
}

export interface Place {
  file: string;
  lines?: LineSpan; // the whole file when unset
}

export interface CountRange {
  min?: number;
  max?: number;
}

export interface Expected {
  expect: 'findings' | 'clean';
  must: Place[];
  must_not: Place[];
  count?: CountRange;
}

export interface TestFile {
  path: string;
  content: string;
}

// Where the code of a test comes from. `patch` makes a review of the change; without it the code is audited.
export type Code =
  | { from: 'repo'; dir: string; patch?: string }
  | { from: 'files'; files: TestFile[]; patch?: string }
  | { from: 'history'; base: string; head: string }
  | { from: 'commit'; commit: string };

export interface RuleTest {
  name: string;
  expected: Expected;
  code: Code;
}

// A test found in a rule's `tests/`; reading it can throw InvalidTest.
export interface FoundTest {
  name: string;
  read: () => RuleTest;
}

// The test itself is broken. It fails, and the rule never runs on it.
export class InvalidTest extends Error {}

const LINES_ERROR = '`lines` must be a line number or [first, last], with first not after last';
const COUNT_ERROR = '`count` must be a number of findings or { min, max }';

const lineNumber = z.number({ error: LINES_ERROR }).int(LINES_ERROR).positive(LINES_ERROR);
const LinesSchema = z.union([lineNumber, z.tuple([lineNumber, lineNumber])], { error: LINES_ERROR })
  .refine((lines) => typeof lines === 'number' || lines[0] <= lines[1], LINES_ERROR)
  .transform((lines): LineSpan => typeof lines === 'number'
    ? { from: lines, to: lines }
    : { from: lines[0], to: lines[1] });

const PlaceSchema = z.strictObject({
  file: z.string({ error: 'a place needs a `file`' }).min(1, 'a place needs a `file`'),
  lines: LinesSchema.optional(),
}, { error: 'a place must be { file, lines }' });

const findingCount = z.number({ error: COUNT_ERROR }).int(COUNT_ERROR).nonnegative(COUNT_ERROR);
const CountSchema = z.union([findingCount, z.strictObject({ min: findingCount.optional(), max: findingCount.optional() })],
  { error: COUNT_ERROR })
  .transform((count): CountRange => typeof count === 'number' ? { min: count, max: count } : count)
  .refine((count) => count.min === undefined || count.max === undefined || count.min <= count.max,
    '`count` has a `min` above its `max`');

const expectedFields = {
  expect: z.enum(['findings', 'clean'], { error: '`expect` is required: findings or clean' }),
  must: z.array(PlaceSchema, { error: '`must` must be a list of places' }).optional().default([]),
  must_not: z.array(PlaceSchema, { error: '`must_not` must be a list of places' }).optional().default([]),
  count: CountSchema.optional(),
};

// A commit id made only of digits would be read as a number and lose its leading zeros.
const commitIsh = (field: string) =>
  z.string({ error: `\`${field}\` must be a commit-ish in quotes, like "main" or "4a1c9e0"` }).min(1);

const SingleFileTestSchema = z.strictObject(expectedFields).superRefine(cleanMeansNoFinding);

const DirectoryTestSchema = z.strictObject({
  ...expectedFields,
  base: commitIsh('base').optional(),
  head: commitIsh('head').optional(),
  commit: commitIsh('commit').optional(),
}).superRefine(cleanMeansNoFinding);

type DirectoryTestFields = z.output<typeof DirectoryTestSchema>;

function cleanMeansNoFinding(fields: { expect: string; must: Place[]; count?: CountRange }, ctx: z.RefinementCtx): void {
  if (fields.expect !== 'clean') return;
  const contradicting = [fields.must.length > 0 ? 'must' : '', fields.count !== undefined ? 'count' : ''].filter(Boolean);
  for (const field of contradicting) {
    ctx.addIssue({ code: 'custom', message: `\`expect: clean\` already means no finding, so \`${field}\` makes no sense with it` });
  }
}

// Each directory with test.yaml and each .md file in `<rule>/tests/` is a test; other files are not.
export function findTests(judge: Judge): FoundTest[] {
  const directory = ruleDirectory(judge);
  const testsDir = directory === undefined ? undefined : path.join(directory, TESTS_DIR);
  if (testsDir === undefined || !fs.existsSync(testsDir)) return [];

  return fs.readdirSync(testsDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry): FoundTest[] => {
      const entryPath = path.join(testsDir, entry.name);
      if (entry.isDirectory()) return [{ name: entry.name, read: () => readDirectoryTest(entry.name, entryPath) }];
      if (entry.isFile() && entry.name.endsWith(SINGLE_FILE_EXTENSION)) {
        const name = path.basename(entry.name, SINGLE_FILE_EXTENSION);
        return [{ name, read: () => readSingleFileTest(name, entryPath) }];
      }
      return [];
    });
}

// A rule's tests break it on purpose, so a review leaves out `<rules dir>/*/tests/**` of every rules directory,
// whatever a rule's scope says.
export function withoutRuleTests(context: EvaluationContext, ruleDirs: string[]): EvaluationContext {
  const root = realPath(context.root ?? repoRoot());
  const dirs = ruleDirs.map((dir) => path.relative(root, realPath(dir)));
  const isTestFile = (file: string) => dirs.some((dir) => isRuleTestPath(path.relative(dir, file)));

  const files = context.files.filter((file) => !isTestFile(file.path));
  if (context.rawDiff === undefined) return { ...context, files };

  const rawDiff = splitDiffByFile(context.rawDiff)
    .filter((section) => !isTestFile(section.path))
    .map((section) => section.text)
    .join('');
  return { ...context, rawDiff, files };
}

// `<rule>/tests/<file>`, relative to a rules directory; `..` and hidden directories are no rules.
function isRuleTestPath(relative: string): boolean {
  const [rule, tests, ...rest] = relative.split(path.sep);
  return !path.isAbsolute(relative) && !rule.startsWith('.') && tests === TESTS_DIR && rest.length > 0;
}

// Git reports the real root (/tmp is /private/tmp on macOS), so the rules directory is resolved the same way.
function realPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

export function modeOf(code: Code): Mode {
  if (code.from === 'history') return 'review';
  if (code.from === 'commit') return 'audit';
  return code.patch === undefined ? 'audit' : 'review';
}

function readDirectoryTest(name: string, dir: string): RuleTest {
  const testFile = path.join(dir, TEST_FILE);
  if (!fs.existsSync(testFile)) throw new InvalidTest(`the test directory has no ${TEST_FILE}`);

  const fields = parseFields(DirectoryTestSchema, parseYaml(fs.readFileSync(testFile, 'utf-8')), TEST_FILE);
  return { name, expected: expectedOf(fields), code: directoryCode(dir, fields) };
}

// Exactly one place the code comes from, so a test never checks other code than its author meant.
function directoryCode(dir: string, fields: DirectoryTestFields): Code {
  const repo = path.join(dir, REPO_DIR);
  const patchFile = path.join(dir, PATCH_FILE);
  const hasRepo = fs.existsSync(repo) && fs.statSync(repo).isDirectory();
  const hasHistory = fields.base !== undefined || fields.head !== undefined;
  const sources = [
    hasRepo ? `${REPO_DIR}/` : '',
    hasHistory ? '`base` and `head`' : '',
    fields.commit !== undefined ? '`commit`' : '',
  ].filter(Boolean);

  if (fs.existsSync(patchFile) && !hasRepo) throw new InvalidTest(`${PATCH_FILE} needs ${REPO_DIR}/, the code it changes`);
  if (sources.length === 0) throw new InvalidTest(`no code: give ${REPO_DIR}/, \`base\` and \`head\`, or \`commit\``);
  if (sources.length > 1) throw new InvalidTest(`two code sources, ${sources.join(' and ')}: give only one`);
  if (hasRepo) {
    const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf-8') : undefined;
    return { from: 'repo', dir: repo, patch };
  }
  if (fields.commit !== undefined) return { from: 'commit', commit: fields.commit };
  if (fields.base === undefined || fields.head === undefined) {
    throw new InvalidTest('`base` and `head` come together: give both, or `commit` alone for an audit');
  }
  return { from: 'history', base: fields.base, head: fields.head };
}

function readSingleFileTest(name: string, file: string): RuleTest {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(fs.readFileSync(file, 'utf-8'));
  } catch (error: any) {
    throw new InvalidTest(`the frontmatter is not valid YAML: ${yamlProblem(error)}`);
  }
  const history = HISTORY_FIELDS.filter((field) => field in parsed.data);
  if (history.length > 0) {
    throw new InvalidTest(`a single-file test holds its code in the file, so it takes no ${history.map((field) => `\`${field}\``).join(', ')}`);
  }
  const fields = parseFields(SingleFileTestSchema, parsed.data, 'the frontmatter');
  return { name, expected: expectedOf(fields), code: { from: 'files', ...readBody(parsed.content) } };
}

// `## <path>` and the code block after it is a file, `## change` and a diff block is the change.
// Everything else is a note for people, so it never reaches the model.
function readBody(body: string): { files: TestFile[]; patch?: string } {
  const files: TestFile[] = [];
  let patch: string | undefined;
  let hasChangeHeading = false;

  for (const { heading, info, text } of codeBlocksUnderHeadings(body)) {
    if (heading.toLowerCase() === CHANGE_HEADING) {
      hasChangeHeading = true;
      if (info === 'diff' && patch === undefined) patch = text;
      continue;
    }
    if (text === undefined) continue;
    const filePath = safeRelativePath(heading);
    if (files.some((file) => file.path === filePath)) throw new InvalidTest(`two code blocks for ${filePath}`);
    files.push({ path: filePath, content: text });
  }
  if (hasChangeHeading && patch === undefined) throw new InvalidTest('`## change` has no ```diff block');
  return { files, patch };
}

interface HeadingBlock {
  heading: string;
  info?: string;
  text?: string; // the first code block under the heading; unset when it has none
}

// Lines inside a code block are code, so a `## ` there is never a heading.
function codeBlocksUnderHeadings(body: string): HeadingBlock[] {
  const blocks: HeadingBlock[] = [];
  let current: HeadingBlock | undefined;
  let fence: { marker: string; info: string; lines: string[] } | undefined;

  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      if (closesFence(line, fence.marker)) {
        if (current && current.text === undefined) Object.assign(current, { info: fence.info, text: `${fence.lines.join('\n')}\n` });
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    const heading = HEADING.exec(line);
    if (open) {
      fence = { marker: open[1], info: open[2], lines: [] };
    } else if (heading) {
      current = { heading: heading[1].replace(/^`(.+)`$/, '$1') };
      blocks.push(current);
    }
  }
  return blocks;
}

function closesFence(line: string, marker: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.length >= marker.length && trimmed === marker[0].repeat(trimmed.length);
}

// The file is written into the test's copy, so it must stay inside it.
function safeRelativePath(heading: string): string {
  const normalized = path.posix.normalize(heading);
  if (heading === '' || path.posix.isAbsolute(heading) || normalized === '..' || normalized.startsWith('../')) {
    throw new InvalidTest(`\`## ${heading}\` is not a path inside the test's repository`);
  }
  return normalized;
}

function parseYaml(text: string): unknown {
  try {
    return yaml.safeLoad(text);
  } catch (error: any) {
    throw new InvalidTest(`${TEST_FILE} is not valid YAML: ${yamlProblem(error)}`);
  }
}

function parseFields<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  if (data === undefined || data === null) throw new InvalidTest(`${source} is empty; it needs at least \`expect\``);
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new InvalidTest(parsed.error.issues.map(describeIssue).join('; '));
}

// Each message names its field, so only the place it sits in is added: `must[0]: a place needs a \`file\``.
function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return located(issue.path, issue.keys.map((key) => `unknown field \`${key}\``).join(', '));
  }
  const field = issue.path.at(-1);
  return located(typeof field === 'string' ? issue.path.slice(0, -1) : issue.path, issue.message);
}

function located(at: PropertyKey[], message: string): string {
  const where = at.map((key) => typeof key === 'number' ? `[${key}]` : `.${String(key)}`).join('').replace(/^\./, '');
  return where === '' ? message : `${where}: ${message}`;
}

function expectedOf(fields: Expected): Expected {
  return { expect: fields.expect, must: fields.must, must_not: fields.must_not, count: fields.count };
}

// js-yaml puts a snippet of the source under its message; the reason and the line are enough on one line.
function yamlProblem(error: any): string {
  if (typeof error?.reason === 'string' && error.mark) return `${error.reason} (line ${error.mark.line + 1})`;
  return String(error?.message ?? error).split('\n')[0];
}
