import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { testRules, testExitCode, formatTestResults, TestEntry } from '../../src/rule-test.js';
import { withoutRuleTests } from '../../src/rule-test-spec.js';
import { getEngine, Engine } from '../../src/engines/index.js';
import { defaultSettings } from '../../src/validator.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext } from '../../src/types.js';

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

// A rule in the directory form, `<rules dir>/<id>/RULE.md`, which is where tests live.
function rule(id: string, overrides: Partial<Judge> = {}): Judge {
  return {
    ...defaultSettings(), id, name: id, format: 'rule', instructions: `Rule ${id}.`, scope: ['src/**/*.py'],
    filePath: path.join(rulesDir, id, 'RULE.md'), isValid: true, validationErrors: [], ...overrides
  } as Judge;
}

function replyWith(findings: object[]): Promise<{ rawOutput: string; durationMs: number }> {
  return Promise.resolve({ rawOutput: JSON.stringify(findings), durationMs: 1 });
}

function finding(file: string, line: number | string): object {
  return { file, line, severity: 'low', message: 'print call' };
}

function prompts(): string[] {
  return run.mock.calls.map(([request]) => request.prompt);
}

function summary(entries: TestEntry[]) {
  return entries.map(({ rule, test, mode, status, reason }) => ({ rule, test, mode, status, reason }));
}

const CART = 'def total(items):\n    return sum(items)\n';
const PRICES = '"""CANARY_UNTOUCHED"""\nPRICES = {}\n';
const PRINT_PATCH = `diff --git a/src/cart.py b/src/cart.py
--- a/src/cart.py
+++ b/src/cart.py
@@ -1,2 +1,4 @@
 def total(items):
-    return sum(items)
+    result = sum(items)
+    print(result)
+    return result
`;

beforeEach(() => {
  rulesDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judges-rule-test-')));
  run.mockReset();
  vi.mocked(getEngine).mockReturnValue({ name: 'claude', isAvailable: () => true, run });
});

afterEach(() => {
  fs.rmSync(rulesDir, { recursive: true, force: true });
});

describe('directory tests', () => {
  it('reviews the change of a patch to repo/, and leaves the untouched files out', async () => {
    writeFile('no-print/tests/prints-total/test.yaml', 'expect: findings\nmust:\n  - file: src/cart.py\n    lines: 3\n');
    writeFile('no-print/tests/prints-total/change.patch', PRINT_PATCH);
    writeFile('no-print/tests/prints-total/repo/src/cart.py', CART);
    writeFile('no-print/tests/prints-total/repo/src/prices.py', PRICES);
    run.mockImplementation(() => replyWith([finding('src/cart.py', 3)]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(entry).toMatchObject({ rule: 'no-print', test: 'prints-total', mode: 'review', status: 'passed', reason: null });
    expect(entry.run).toMatchObject({ status: 'ok', inline: ['src/cart.py'] });
    expect(entry.findings).toEqual([expect.objectContaining({ file: 'src/cart.py', line: 3, rule_id: 'no-print' })]);
    expect(prompts()[0]).toContain('+    print(result)');
    expect(prompts()[0]).not.toContain('CANARY_UNTOUCHED');
  });

  it('audits every file of repo/ without a patch, and never changes the test', async () => {
    const cart = writeFile('no-print/tests/old-prints/repo/src/cart.py', CART);
    writeFile('no-print/tests/old-prints/repo/src/prices.py', PRICES);
    writeFile('no-print/tests/old-prints/test.yaml', 'expect: clean\n');
    run.mockImplementation(() => replyWith([]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(entry).toMatchObject({ test: 'old-prints', mode: 'audit', status: 'passed' });
    expect(entry.run?.inline?.sort()).toEqual(['src/cart.py', 'src/prices.py']);
    expect(fs.readFileSync(cart, 'utf-8')).toBe(CART);
  });

  it('prints the entry in the shape of the spec: rule, test, mode, status, reason, findings, run', async () => {
    writeFile('no-print/tests/old-prints/repo/src/cart.py', CART);
    writeFile('no-print/tests/old-prints/test.yaml', 'expect: clean\n');
    run.mockImplementation(() => replyWith([]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(Object.keys(entry)).toEqual(['rule', 'test', 'mode', 'status', 'reason', 'findings', 'run']);
    expect(entry.run).not.toHaveProperty('judgeId');
    expect(entry.run).not.toHaveProperty('issues');
  });
});

describe('single-file tests', () => {
  const REVIEW = `---
# CANARY_FRONTMATTER
expect: findings
must:
  - file: src/cart.py
    lines: 3
---
The change prints the total. CANARY_NOTE

## src/cart.py
\`\`\`python
def total(items):
    return sum(items)
\`\`\`

## src/prices.py
\`\`\`python
"""CANARY_UNTOUCHED"""
\`\`\`

## change
\`\`\`diff
${PRINT_PATCH}\`\`\`
`;

  it('reviews the ## change, and sends neither the expected result nor the notes', async () => {
    writeFile('no-print/tests/prints-total.md', REVIEW);
    run.mockImplementation(() => replyWith([finding('src/cart.py', 3)]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(entry).toMatchObject({ test: 'prints-total', mode: 'review', status: 'passed' });
    expect(entry.run?.inline).toEqual(['src/cart.py']);
    for (const canary of ['CANARY_FRONTMATTER', 'CANARY_NOTE', 'CANARY_UNTOUCHED', 'expect: findings']) {
      expect(prompts()[0]).not.toContain(canary);
    }
  });

  it('audits the files without ## change; a ## inside a code block is code', async () => {
    writeFile('no-print/tests/old-print.md', `---
expect: findings
---
## src/report.py
\`\`\`python
## not a heading
print("Sales report")
\`\`\`
`);
    run.mockImplementation(() => replyWith([finding('src/report.py', 2)]));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(entry).toMatchObject({ mode: 'audit', status: 'passed' });
    expect(prompts()[0]).toContain('1| ## not a heading');
    expect(prompts()[0]).toContain('2| print("Sales report")');
  });
});

describe('invalid tests', () => {
  it.each([
    ['bad YAML', 'bad-yaml/test.yaml', 'expect: findings\nmust: [\n', /test\.yaml is not valid YAML/],
    ['a typo field', 'typo/test.yaml', 'expect: findings\nmust_nt:\n  - file: src/app.py\n', /unknown field `must_nt`/],
    ['no expect', 'no-expect/test.yaml', 'must:\n  - file: src/app.py\n', /`expect` is required/],
    ['clean with must', 'clean-must/test.yaml', 'expect: clean\nmust:\n  - file: src/app.py\n', /`must` makes no sense/],
    ['clean with count', 'clean-count/test.yaml', 'expect: clean\ncount: 0\n', /`count` makes no sense/],
    ['a place without file', 'no-file/test.yaml', 'expect: findings\nmust:\n  - lines: 3\n', /must\[0\]: a place needs a `file`/],
    ['lines in the wrong order', 'lines/test.yaml', 'expect: findings\nmust:\n  - file: a.py\n    lines: [5, 2]\n', /`lines` must be/],
    ['zero as a line', 'zero/test.yaml', 'expect: findings\nmust_not:\n  - file: a.py\n    lines: 0\n', /`lines` must be/],
    ['two code sources', 'two/test.yaml', 'commit: main\nexpect: findings\n', /two code sources, repo\/ and `commit`/],
    ['base without head', 'base-only/test.yaml', 'base: main\nexpect: findings\n', /`base` and `head` come together/],
  ])('fails %s as invalid, without a model call', async (_, file, content, reason) => {
    writeFile(`no-print/tests/${file}`, content);
    if (!file.startsWith('base-only')) writeFile(`no-print/tests/${path.dirname(file)}/repo/src/app.py`, 'print(1)\n');

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ mode: null, status: 'failed', findings: [], run: null });
    expect(entry.reason).toMatch(/^invalid: /);
    expect(entry.reason).toMatch(reason);
  });

  it.each([
    ['a directory without test.yaml', 'empty/repo/src/app.py', 'print(1)\n', /has no test\.yaml/],
    ['a directory without code', 'no-code/test.yaml', 'expect: findings\n', /no code/],
    ['a patch without repo/', 'patch-only/change.patch', PRINT_PATCH, /change\.patch needs repo\//],
    ['a single-file test with a commit', 'history.md', '---\ncommit: main\nexpect: clean\n---\n', /takes no `commit`/],
    ['a frontmatter that is no mapping', 'scalar.md', '---\nfindings\n---\n', /the frontmatter must be a mapping/],
    ['a test.yaml that is a list', 'list/test.yaml', '- expect: findings\n', /test\.yaml must be a mapping/],
    ['## change without a diff block', 'no-diff.md', '---\nexpect: clean\n---\n## change\n```\nx\n```\n', /`## change` has no ```diff block/],
    ['a path outside the repository', 'escape.md', '---\nexpect: clean\n---\n## ../outside.py\n```\nx\n```\n', /not a path inside/],
  ])('fails %s as invalid', async (_, file, content, reason) => {
    writeFile(`no-print/tests/${file}`, content);
    if (file === 'patch-only/change.patch') writeFile('no-print/tests/patch-only/test.yaml', 'expect: findings\n');

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ status: 'failed', run: null });
    expect(entry.reason).toMatch(reason);
  });

  it('fails a patch that does not apply as invalid, and still runs the other tests', async () => {
    writeFile('no-print/tests/stale/test.yaml', 'expect: findings\n');
    writeFile('no-print/tests/stale/repo/src/cart.py', 'something else\n');
    writeFile('no-print/tests/stale/change.patch', PRINT_PATCH);
    writeFile('no-print/tests/valid/test.yaml', 'expect: clean\n');
    writeFile('no-print/tests/valid/repo/src/cart.py', CART);
    run.mockImplementation(() => replyWith([]));

    const entries = await testRules([rule('no-print')], 'claude');

    expect(summary(entries)).toEqual([
      { rule: 'no-print', test: 'stale', mode: null, status: 'failed', reason: expect.stringMatching(/^invalid: the patch does not apply/) },
      { rule: 'no-print', test: 'valid', mode: 'audit', status: 'passed', reason: null },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('verdicts', () => {
  async function verdictOf(testYaml: string, files: Record<string, string>, findings: object[]): Promise<TestEntry> {
    writeFile('no-print/tests/case/test.yaml', testYaml);
    for (const [file, content] of Object.entries(files)) writeFile(`no-print/tests/case/repo/${file}`, content);
    run.mockImplementation(() => replyWith(findings));
    const [entry] = await testRules([rule('no-print')], 'claude');
    return entry;
  }

  const report = { 'src/report.py': 'a\nb\nc\nd\ne\n' };

  it.each([
    ['missed', 'expect: findings\n', [], 'missed: expected findings, got none'],
    ['false-positive', 'expect: clean\n', [finding('src/report.py', 2)], 'false-positive: expected no finding, got 1: src/report.py:2'],
    ['must, when a finding of the right count is in the wrong place', 'expect: findings\nmust:\n  - file: src/report.py\n    lines: 5\n',
      [finding('src/report.py', 2)], 'must: no finding at src/report.py:5; the findings are at src/report.py:2'],
    ['must-not', 'expect: findings\nmust_not:\n  - file: src/report.py\n    lines: [1, 2]\n',
      [finding('src/report.py', 4), finding('src/report.py', 2)], 'must-not: a finding at src/report.py:2, a place in must_not (src/report.py:1-2)'],
    ['count', 'expect: findings\ncount: { min: 2 }\n', [finding('src/report.py', 2)], 'count: expected at least 2 findings, got 1'],
  ])('fails with %s', async (_, testYaml, findings, reason) => {
    expect((await verdictOf(testYaml, report, findings)).reason).toBe(reason);
  });

  it('passes when a finding over a range overlaps a must place, and other findings are allowed', async () => {
    const entry = await verdictOf('expect: findings\nmust:\n  - file: src/report.py\n    lines: [3, 4]\n',
      report, [finding('src/report.py', '4-5'), finding('src/report.py', 1)]);

    expect(entry).toMatchObject({ status: 'passed', reason: null });
  });

  it('fails a clean test when the engine fails: no finding is no verdict', async () => {
    writeFile('no-print/tests/case/test.yaml', 'expect: clean\n');
    writeFile('no-print/tests/case/repo/src/cart.py', CART);
    run.mockRejectedValue(new Error('API error: overloaded'));

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(entry).toMatchObject({ status: 'failed', reason: 'did-not-run: the rule ended with status error (API error: overloaded)' });
    expect(entry.run).toMatchObject({ status: 'error' });
  });

  it('fails a clean test with nothing in scope, without a model call', async () => {
    const entry = await verdictOf('expect: clean\n', { 'docs/usage.md': 'Usage.\n' }, []);

    expect(run).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ status: 'failed', reason: 'did-not-run: the rule ended with status skipped (no files in scope)' });
  });

  it('fails every test of an invalid rule with did-not-run, without a model call', async () => {
    writeFile('no-print/tests/case/test.yaml', 'expect: clean\n');
    writeFile('no-print/tests/case/repo/src/cart.py', CART);

    const [entry] = await testRules([rule('no-print', { isValid: false, validationErrors: ['error: `check` is not a rule field'] })], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entry.reason).toMatch(/^did-not-run: the rule ended with status error \(invalid rule: /);
  });
});

describe('which tests run', () => {
  it('skips a rule without tests, a rule file included, and leaves out JUDGE.md judges', async () => {
    const entries = await testRules([
      rule('comments-explain-why', { filePath: path.join(rulesDir, 'comments-explain-why.md') }),
      rule('empty-dir'),
      rule('srp', { format: 'judge-md', filePath: path.join(rulesDir, 'srp', 'JUDGE.md') }),
    ], 'claude');

    expect(entries).toEqual([
      { rule: 'comments-explain-why', test: null, mode: null, status: 'skipped', reason: 'no tests', findings: [], run: null },
      { rule: 'empty-dir', test: null, mode: null, status: 'skipped', reason: 'no tests', findings: [], run: null },
    ]);
  });

  it('finds no tests in a file named tests', async () => {
    writeFile('no-print/tests', 'not a directory');

    expect(await testRules([rule('no-print')], 'claude')).toEqual([expect.objectContaining({ status: 'skipped', reason: 'no tests' })]);
  });

  it('ignores hidden entries and files other than .md in tests/, and sorts by rule, then test', async () => {
    for (const test of ['b-test', 'a-test']) {
      writeFile(`b-rule/tests/${test}/test.yaml`, 'expect: clean\n');
      writeFile(`b-rule/tests/${test}/repo/src/a.py`, 'x\n');
    }
    writeFile('b-rule/tests/notes.txt', 'not a test');
    writeFile('b-rule/tests/.draft/test.yaml', 'not: valid');
    writeFile('a-rule/tests/only.md', '---\nexpect: clean\n---\n## src/a.py\n```\nx\n```\n');
    run.mockImplementation(() => replyWith([]));

    const entries = await testRules([rule('b-rule'), rule('a-rule')], 'claude');

    expect(entries.map((entry) => `${entry.rule}/${entry.test}`)).toEqual(['a-rule/only', 'b-rule/a-test', 'b-rule/b-test']);
  });
});

describe('history tests', () => {
  let repo: string;
  const originalCwd = process.cwd();
  const git = (args: string) => execSync(`git ${args}`, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' });
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judges-history-')));
    git('init -q -b main');
    git('config user.email test@example.com');
    git('config user.name test');
    write('src/cart.py', '"""CANARY_MAIN_CART"""\n');
    write('src/prices.py', '"""CANARY_PRICES"""\n');
    git('add -A');
    git('commit -q -m base');
    git('checkout -q -b feature');
    write('src/receipt.py', '"""CANARY_FEATURE"""\nprint(1)\n');
    git('add -A');
    git('commit -q -m receipt');
    write('src/cart.py', '"""CANARY_ON_DISK"""\nprint(2)\n');
    write('src/staged.py', '"""CANARY_STAGED"""\n');
    git('add src/staged.py');
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('reviews base...head and audits a commit, never seeing or touching the working tree and the index', async () => {
    writeFile('no-print/tests/new-receipt/test.yaml', 'base: main\nhead: feature\nexpect: findings\nmust:\n  - file: src/receipt.py\n    lines: 2\n');
    writeFile('no-print/tests/audit-main/test.yaml', 'commit: main\nexpect: clean\n');
    run.mockImplementation((request) => replyWith(request.prompt.includes('CANARY_FEATURE') ? [finding('src/receipt.py', 2)] : []));
    const statusBefore = git('status --porcelain');
    const indexBefore = git('ls-files --stage');

    const entries = await testRules([rule('no-print')], 'claude');

    expect(summary(entries)).toEqual([
      { rule: 'no-print', test: 'audit-main', mode: 'audit', status: 'passed', reason: null },
      { rule: 'no-print', test: 'new-receipt', mode: 'review', status: 'passed', reason: null },
    ]);
    expect(entries[0].run?.inline?.sort()).toEqual(['src/cart.py', 'src/prices.py']);
    expect(entries[1].run?.inline).toEqual(['src/receipt.py']);
    for (const prompt of prompts()) {
      for (const canary of ['CANARY_ON_DISK', 'CANARY_STAGED']) expect(prompt).not.toContain(canary);
    }
    expect(git('status --porcelain')).toBe(statusBefore);
    expect(git('ls-files --stage')).toBe(indexBefore);
    expect(git('rev-parse --abbrev-ref HEAD').trim()).toBe('feature');
  });

  it('fails a test whose commit-ish does not resolve as invalid', async () => {
    writeFile('no-print/tests/gone/test.yaml', 'commit: no-such-branch\nexpect: clean\n');

    const [entry] = await testRules([rule('no-print')], 'claude');

    expect(run).not.toHaveBeenCalled();
    expect(entry.reason).toMatch(/^invalid: `commit: no-such-branch` does not name a commit/);
  });
});

describe('withoutRuleTests', () => {
  it('leaves <rules dir>/*/tests/** out of a review, in the file list and the diff', () => {
    fs.mkdirSync(path.join(rulesDir, 'rules', 'no-print'), { recursive: true });
    const testFile = 'rules/no-print/tests/prints-report/repo/src/report.py';
    const context: EvaluationContext = {
      type: 'diff',
      root: rulesDir,
      rawDiff: `diff --git a/${testFile} b/${testFile}\n+print(1)\ndiff --git a/src/app.py b/src/app.py\n+x = 1\n`,
      files: [{ path: testFile, content: 'print(1)' }, { path: 'src/app.py', content: 'x = 1' }],
    };

    const reviewed = withoutRuleTests(context, [path.join(rulesDir, 'rules')]);

    expect(reviewed.files.map((file) => file.path)).toEqual(['src/app.py']);
    expect(reviewed.rawDiff).toBe('diff --git a/src/app.py b/src/app.py\n+x = 1\n');
  });

  it('keeps the rules themselves, tests outside a rule directory, and every file when the rules are elsewhere', () => {
    fs.mkdirSync(path.join(rulesDir, 'rules'), { recursive: true });
    const paths = ['rules/no-print/RULE.md', 'rules/tests/a.py', 'rules/.hidden/tests/a.py', 'src/no-print/tests/a.py', 'tests/no-print/tests/a.py'];
    const context: EvaluationContext = { type: 'files', root: rulesDir, files: paths.map((file) => ({ path: file, content: '' })) };

    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-other-rules-'));

    expect(withoutRuleTests(context, [path.join(rulesDir, 'rules')]).files.map((file) => file.path)).toEqual(paths);
    expect(withoutRuleTests(context, [elsewhere]).files).toHaveLength(paths.length);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
});

describe('the outcome of judge test', () => {
  function entry(overrides: Partial<TestEntry>): TestEntry {
    return { rule: 'no-print', test: 'prints-total', mode: 'review', status: 'passed', reason: null, findings: [], run: null, ...overrides };
  }

  it('exits 1 only when a test failed; a rule without tests does not fail the run', () => {
    const skipped = entry({ test: null, mode: null, status: 'skipped', reason: 'no tests' });

    expect(testExitCode([entry({}), skipped])).toBe(0);
    expect(testExitCode([entry({}), entry({ status: 'failed', reason: 'missed: expected findings, got none' })])).toBe(1);
  });

  it('prints one line per test with its mode, then the counts', () => {
    const text = formatTestResults([
      entry({}),
      entry({ test: 'old-prints', mode: 'audit', status: 'failed', reason: 'missed: expected findings, got none' }),
      entry({ test: 'typo', mode: null, status: 'failed', reason: 'invalid: unknown field `must_nt`' }),
      entry({ rule: 'other', test: null, mode: null, status: 'skipped', reason: 'no tests' }),
    ]);

    expect(text.split('\n').map((line) => line.replace(/\x1b\[\d+m/g, ''))).toEqual([
      '✔ no-print/prints-total (review)',
      '✘ no-print/old-prints (audit): missed: expected findings, got none',
      '✘ no-print/typo: invalid: unknown field `must_nt`',
      '○ other: skipped (no tests)',
      '',
      '1 passed, 2 failed, 1 skipped',
    ]);
  });
});
