import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  blankExpectLines, expectFromName, findFixtures, judgeFixture, withoutRuleFixtures, ExpectedLine
} from '../../src/fixtures.js';
import { defaultSettings } from '../../src/validator.js';
import { Judge } from '../../src/judges.js';
import { EvaluationContext, Issue, JudgeResult } from '../../src/types.js';

function rule(filePath: string, overrides: Partial<Judge> = {}): Judge {
  return { ...defaultSettings(), id: 'no-print', format: 'rule', filePath, ...overrides } as Judge;
}

function ran(overrides: Partial<JudgeResult> = {}): JudgeResult {
  return { judgeId: 'no-print', displayName: 'no-print', file: '', status: 'ok', issues: [], durationMs: 1, ...overrides };
}

function finding(file: string, line: Issue['line']): Issue {
  return { file, line, severity: 'medium', message: 'print call' };
}

describe('expectFromName', () => {
  it('reads the kind of fixture from its name', () => {
    expect(expectFromName('violation')).toBe('violation');
    expect(expectFromName('violation-nested')).toBe('violation');
    expect(expectFromName('pass')).toBe('pass');
    expect(expectFromName('pass-logger')).toBe('pass');
  });

  it('rejects any other name', () => {
    for (const name of ['passes', 'violations', 'pass-', 'good', 'Violation']) {
      expect(expectFromName(name)).toBeUndefined();
    }
  });
});

describe('blankExpectLines', () => {
  it('blanks the rule-expect line and keeps every line number', () => {
    const content = 'def total(items):\n    # rule-expect: no-print\n    print(items)\n';

    const blanked = blankExpectLines('src/app.py', content, 'no-print');

    expect(blanked.content).toBe('def total(items):\n\n    print(items)\n');
    expect(blanked.expected).toEqual([{ file: 'src/app.py', line: 3 }]);
  });

  it('expects the next line that is neither blank nor another marker', () => {
    const content = '// rule-expect: no-print\n\n// rule-ignore: other -- reason\nconsole.log(x)';

    expect(blankExpectLines('a.js', content, 'no-print').expected).toEqual([{ file: 'a.js', line: 4 }]);
  });

  it('reads every comment syntax markers use', () => {
    const content = ['<!-- rule-expect: no-print -->', 'a', '-- rule-expect: no-print', 'b', '/* rule-expect: no-print */', 'c'].join('\n');

    expect(blankExpectLines('x', content, 'no-print').expected.map((mark) => mark.line)).toEqual([2, 4, 6]);
  });

  it('blanks an expectation for another rule without expecting anything', () => {
    const blanked = blankExpectLines('a.py', '# rule-expect: other\nprint(1)', 'no-print');

    expect(blanked.content).toBe('\nprint(1)');
    expect(blanked.expected).toEqual([]);
  });

  it('keeps a CRLF line ending', () => {
    expect(blankExpectLines('a.py', '# rule-expect: no-print\r\nprint(1)\r\n', 'no-print').content).toBe('\r\nprint(1)\r\n');
  });
});

describe('judgeFixture', () => {
  const marked: ExpectedLine[] = [{ file: 'src/app.py', line: 4 }];

  it('fails a fixture the rule did not run on, whatever the findings', () => {
    for (const run of [ran({ status: 'error', error: 'API error: overloaded\ndetails' }), ran({ status: 'timeout' })]) {
      expect(judgeFixture('pass', [], run).reason).toMatch(/^did-not-run: the rule ended with status (error|timeout)/);
    }
    expect(judgeFixture('pass', [], ran({ status: 'skipped', skipReason: 'no files in scope' }))).toEqual({
      result: 'failed', reason: 'did-not-run: the rule ended with status skipped (no files in scope)'
    });
  });

  it('passes a pass fixture without findings and fails one with a finding', () => {
    expect(judgeFixture('pass', [], ran())).toEqual({ result: 'passed' });
    expect(judgeFixture('pass', [], ran({ issues: [finding('src/app.py', 2)] }))).toEqual({
      result: 'failed', reason: 'false-positive: expected no finding, got 1: src/app.py:2'
    });
  });

  it('fails a violation fixture without findings as missed, marked or not', () => {
    for (const expected of [[], marked]) {
      expect(judgeFixture('violation', expected, ran()).reason).toBe('missed: expected at least one finding, got none');
    }
  });

  it('passes an unmarked violation fixture on any finding', () => {
    expect(judgeFixture('violation', [], ran({ issues: [finding('src/other.py', 1)] }))).toEqual({ result: 'passed' });
  });

  it('passes a marked violation fixture when the findings sit on the marked lines', () => {
    const issues = [finding('./src/app.py', 4), finding('src/app.py', '3-5')];

    expect(judgeFixture('violation', marked, ran({ issues }))).toEqual({ result: 'passed' });
  });

  it('fails a marked violation fixture when a marked line has no finding or a finding is elsewhere', () => {
    const issues = [finding('src/app.py', 13), finding('src/other.py', 4)];

    expect(judgeFixture('violation', marked, ran({ issues })).reason).toBe(
      'wrong-line: no finding on the marked line src/app.py:4; a finding on the unmarked line src/app.py:13, src/other.py:4'
    );
    expect(judgeFixture('violation', [...marked, { file: 'src/app.py', line: 9 }], ran({ issues: [finding('src/app.py', 4)] })).reason)
      .toBe('wrong-line: no finding on the marked line src/app.py:9');
    expect(judgeFixture('violation', marked, ran({ issues: [finding('src/app.py', 'N/A')] })).reason).toMatch(/^wrong-line:/);
  });
});

describe('rule fixtures on disk', () => {
  let rulesDir: string;

  beforeEach(() => {
    rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-fixtures-'));
  });

  afterEach(() => {
    fs.rmSync(rulesDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content = 'x'): void {
    const filePath = path.join(rulesDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  it('finds each directory in <id>.fixtures/ as a fixture and ignores the files next to them', () => {
    writeFile('no-print.fixtures/violation-nested/src/a.py');
    writeFile('no-print.fixtures/pass/src/a.py');
    writeFile('no-print.fixtures/odd/src/a.py');
    writeFile('no-print.fixtures/README.md');

    const fixtures = findFixtures(rule(path.join(rulesDir, 'no-print.md')));

    expect(fixtures.map(({ name, expect }) => ({ name, expect })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'odd', expect: undefined },
      { name: 'pass', expect: 'pass' },
      { name: 'violation-nested', expect: 'violation' },
    ]);
    expect(fixtures.find((fixture) => fixture.name === 'pass')?.dir).toBe(path.join(rulesDir, 'no-print.fixtures', 'pass'));
  });

  it('finds no fixtures for a rule without a fixtures directory', () => {
    writeFile('no-print.md');

    expect(findFixtures(rule(path.join(rulesDir, 'no-print.md')))).toEqual([]);
  });

  it('leaves the files of a rule fixture out of a review, in the file list and the diff', () => {
    writeFile('rules/no-print.md');
    const fixtureFile = 'rules/no-print.fixtures/violation/src/report.py';
    const context: EvaluationContext = {
      type: 'diff',
      root: rulesDir,
      rawDiff: `diff --git a/${fixtureFile} b/${fixtureFile}\n+print(1)\ndiff --git a/src/app.py b/src/app.py\n+x = 1\n`,
      files: [{ path: fixtureFile, content: 'print(1)' }, { path: 'src/app.py', content: 'x = 1' }],
    };

    const reviewed = withoutRuleFixtures(context, [rule(path.join(rulesDir, 'rules', 'no-print.md'))]);

    expect(reviewed.files.map((file) => file.path)).toEqual(['src/app.py']);
    expect(reviewed.rawDiff).toBe('diff --git a/src/app.py b/src/app.py\n+x = 1\n');
  });

  it('keeps files that only look like fixtures of another rule', () => {
    writeFile('rules/no-print.md');
    const context: EvaluationContext = {
      type: 'files',
      root: rulesDir,
      files: [{ path: 'rules/other.fixtures/pass/a.py', content: '' }, { path: 'rules/no-print.fixtures.md', content: '' }],
    };

    const reviewed = withoutRuleFixtures(context, [rule(path.join(rulesDir, 'rules', 'no-print.md'))]);

    expect(reviewed.files).toHaveLength(2);
  });
});
