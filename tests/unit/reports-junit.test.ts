import { describe, it, expect } from 'vitest';
import { junitReport, escapeXml } from '../../src/reports/junit.js';
import { ReportFinding } from '../../src/reports/findings.js';
import { JudgeResult } from '../../src/types.js';

function result(judgeId: string, extra: Partial<JudgeResult> = {}): JudgeResult {
  return { judgeId, displayName: judgeId, file: `/rules/${judgeId}.md`, status: 'ok', issues: [], durationMs: 1400, ...extra };
}

function finding(ruleId: string, extra: Partial<ReportFinding> = {}): ReportFinding {
  return { ruleId, path: 'src/cart.py', line: 2, message: 'msg', severity: 'high', fingerprint: 'abc', ...extra };
}

describe('junitReport', () => {
  it('writes one test case per rule, sorted by id, with counts on both suite elements', () => {
    const xml = junitReport(
      [result('test-names-say-what', { status: 'skipped', durationMs: 0, skipReason: 'no files in scope' }), result('no-magic-numbers')],
      [finding('no-magic-numbers', { message: '1.23 is a magic number' })]
    );
    expect(xml).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="judges" tests="2" failures="1" errors="0" skipped="1">',
      '  <testsuite name="judges" tests="2" failures="1" errors="0" skipped="1">',
      '    <testcase classname="judges" name="no-magic-numbers" time="1.4">',
      '      <failure message="1 finding" type="high">src/cart.py:2: 1.23 is a magic number</failure>',
      '    </testcase>',
      '    <testcase classname="judges" name="test-names-say-what" time="0">',
      '      <skipped message="no files in scope"/>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
      ''
    ].join('\n'));
  });

  it('writes a passing rule as an empty test case', () => {
    const xml = junitReport([result('r')], []);
    expect(xml).toContain('<testcase classname="judges" name="r" time="1.4"/>');
    expect(xml).toContain('failures="0"');
  });

  it('lists every finding of a rule in its failure', () => {
    const xml = junitReport([result('r')], [finding('r', { line: 3, message: 'one' }), finding('r', { line: 9, message: 'two' })]);
    expect(xml).toContain('<failure message="2 findings" type="high">src/cart.py:3: one\nsrc/cart.py:9: two</failure>');
  });

  it('writes an error for a rule that errored or stopped on a limit', () => {
    const xml = junitReport([result('a', { status: 'error', error: 'engine crashed' }),
      result('b', { status: 'stopped', stopReason: 'time', error: 'after 60s' })], []);
    expect(xml).toContain('<error message="errored" type="error">engine crashed</error>');
    expect(xml).toContain('<error message="stopped (time)" type="stopped">after 60s</error>');
    expect(xml).toContain('tests="2" failures="0" errors="2" skipped="0"');
  });

  it('names the failure after the highest severity when severities differ', () => {
    const xml = junitReport([result('markers')], [finding('markers', { severity: 'low' }), finding('markers', { severity: 'medium' })]);
    expect(xml).toContain('type="medium"');
  });

  it('escapes XML characters in messages and reasons', () => {
    const xml = junitReport(
      [result('r'), result('s', { status: 'skipped', skipReason: 'a "quoted" <reason>' })],
      [finding('r', { message: '"bad" must be >= 0 & <= total' })]
    );
    expect(xml).toContain('src/cart.py:2: &quot;bad&quot; must be &gt;= 0 &amp; &lt;= total</failure>');
    expect(xml).toContain('<skipped message="a &quot;quoted&quot; &lt;reason&gt;"/>');
  });
});

describe('escapeXml', () => {
  it('drops control characters XML cannot hold and keeps tabs and newlines', () => {
    expect(escapeXml('a\u0000b\u001Bc\td\ne')).toBe('abc\td\ne');
  });

  it("escapes the apostrophe", () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });
});
