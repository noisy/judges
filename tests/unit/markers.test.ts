import { describe, it, expect } from 'vitest';
import { findMarkers, isCovered, parseLineRange, Marker } from '../../src/markers.js';

function lines(...content: string[]): string {
  return content.join('\n');
}

describe('findMarkers', () => {
  it.each([
    ['#', '# rule-ignore: my-rule -- reason here'],
    ['//', '// rule-ignore: my-rule -- reason here'],
    ['--', '-- rule-ignore: my-rule -- reason here'],
    ['/* */', '/* rule-ignore: my-rule -- reason here */'],
    ['<!-- -->', '<!-- rule-ignore: my-rule -- reason here -->'],
    [';', '; rule-ignore: my-rule -- reason here'],
  ])('strips %s comment syntax', (_, markerLine) => {
    const [marker] = findMarkers('a.ts', lines('code();', markerLine, 'x = 1'));

    expect(marker).toEqual({
      kind: 'ignore',
      ruleId: 'my-rule',
      reason: 'reason here',
      file: 'a.ts',
      markerLine: 2,
      scope: { line: 3 },
    });
  });

  it('reads rule-todo as known debt', () => {
    const [marker] = findMarkers('a.py', lines('x = 1', '    # rule-todo:   my-rule -- pay later', 'y = 2'));

    expect(marker).toEqual(expect.objectContaining({ kind: 'todo', reason: 'pay later' }));
  });

  it('covers the next line that is neither blank nor another marker', () => {
    const markers = findMarkers('a.ts', lines(
      'code();',
      '// rule-ignore: one -- a',
      '',
      '// rule-todo: two -- b',
      'target();'
    ));

    expect(markers.map((m) => m.scope)).toEqual([{ line: 5 }, { line: 5 }]);
  });

  it('treats a marker on the first line as file-level', () => {
    const [marker] = findMarkers('a.ts', lines('// rule-ignore: my-rule -- generated file', 'code();'));

    expect(marker.scope).toBe('file');
  });

  it('treats a marker right after a shebang as file-level', () => {
    const [marker] = findMarkers('a.sh', lines('#!/usr/bin/env bash', '# rule-todo: my-rule -- legacy script', 'echo'));

    expect(marker).toEqual(expect.objectContaining({ scope: 'file', markerLine: 2 }));
  });

  it('makes every marker in the leading run file-level', () => {
    const markers = findMarkers('a.ts', lines('// rule-ignore: one -- a', '// rule-ignore: two -- b', 'code();'));

    expect(markers.map((m) => m.scope)).toEqual(['file', 'file']);
  });

  it('leaves the reason undefined when it is missing or empty', () => {
    const markers = findMarkers('a.ts', lines(
      'code();',
      '// rule-ignore: one',
      '// rule-ignore: two --',
      '/* rule-ignore: three -- */',
      'x();'
    ));

    expect(markers.map((m) => m.reason)).toEqual([undefined, undefined, undefined]);
  });

  it('ignores markers that are not a whole-line comment', () => {
    const content = lines('const s = "// rule-ignore: one -- inside a string";', 'rule-ignore: two -- no comment');

    expect(findMarkers('a.ts', content)).toEqual([]);
  });

  it('does not take placeholders like <rule-id> for a rule id', () => {
    expect(findMarkers('a.md', lines('text', '# rule-ignore: <rule-id> -- <reason>'))).toEqual([]);
  });
});

describe('parseLineRange', () => {
  it.each([
    [42, { from: 42, to: 42 }],
    ['42', { from: 42, to: 42 }],
    ['45-60', { from: 45, to: 60 }],
    ['60 - 45', { from: 45, to: 60 }],
    ['N/A', null],
    ['global', null],
  ])('parses %s', (line, expected) => {
    expect(parseLineRange(line)).toEqual(expected);
  });
});

describe('isCovered', () => {
  function lineMarker(line: number, overrides: Partial<Marker> = {}): Marker {
    return { kind: 'ignore', ruleId: 'r', reason: 'why', file: 'src/a.ts', markerLine: line - 1, scope: { line }, ...overrides };
  }

  it('covers the marked line for the same rule and file', () => {
    expect(isCovered([lineMarker(10)], 'r', 'src/a.ts', 10)).toBe(true);
    expect(isCovered([lineMarker(10)], 'r', './src/a.ts', '10')).toBe(true);
  });

  it('does not cover another line, rule or file', () => {
    expect(isCovered([lineMarker(10)], 'r', 'src/a.ts', 11)).toBe(false);
    expect(isCovered([lineMarker(10)], 'other', 'src/a.ts', 10)).toBe(false);
    expect(isCovered([lineMarker(10)], 'r', 'src/b.ts', 10)).toBe(false);
  });

  it('covers a range only when every line in it is marked', () => {
    const markers = [lineMarker(10), lineMarker(11)];

    expect(isCovered(markers, 'r', 'src/a.ts', '10-11')).toBe(true);
    expect(isCovered(markers, 'r', 'src/a.ts', '10-12')).toBe(false);
  });

  it('does not cover N/A with a line-level marker', () => {
    expect(isCovered([lineMarker(10)], 'r', 'src/a.ts', 'N/A')).toBe(false);
  });

  it('covers every line, range and N/A with a file-level marker', () => {
    const markers = [lineMarker(1, { scope: 'file' })];

    expect(isCovered(markers, 'r', 'src/a.ts', 99)).toBe(true);
    expect(isCovered(markers, 'r', 'src/a.ts', '5-500')).toBe(true);
    expect(isCovered(markers, 'r', 'src/a.ts', 'N/A')).toBe(true);
  });

  it('does not let a marker without a reason cover anything', () => {
    expect(isCovered([lineMarker(10, { reason: undefined })], 'r', 'src/a.ts', 10)).toBe(false);
  });
});
