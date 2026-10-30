import { describe, it, expect } from 'vitest';
import { findMarkers, markerPlace, namedMarker, parseLineRange, Marker } from '../../src/markers.js';

function lines(...content: string[]): string {
  return content.join('\n');
}

function reasons(content: string): Array<string | undefined> {
  return findMarkers('a.ts', content).map((marker) => marker.reason);
}

describe('findMarkers', () => {
  it.each([
    ['#', '# rule-exception: my-rule -- reason here'],
    ['//', '// rule-exception: my-rule -- reason here'],
    ['--', '-- rule-exception: my-rule -- reason here'],
    [';', '; rule-exception: my-rule -- reason here'],
    ['/* */', '/* rule-exception: my-rule -- reason here */'],
    [' * ', ' * rule-exception: my-rule -- reason here'],
    ['<!-- -->', '<!-- rule-exception: my-rule -- reason here -->'],
    ['"""', '"""rule-exception: my-rule -- reason here"""'],
    ["'''", "''' rule-exception: my-rule -- reason here '''"],
    ['no opener, as inside a docstring', '    rule-exception: my-rule -- reason here'],
  ])('reads a marker after %s', (_, markerLine) => {
    const [marker] = findMarkers('a.ts', lines('code();', markerLine, '', 'x = 1'));

    expect(marker).toEqual({ kind: 'exception', ruleId: 'my-rule', reason: 'reason here', file: 'a.ts', markerLine: 2 });
  });

  it('reads rule-debt as known debt', () => {
    const [marker] = findMarkers('a.py', lines('x = 1', '    # rule-debt:   my-rule -- pay later', 'y = 2'));

    expect(marker).toEqual(expect.objectContaining({ kind: 'debt', reason: 'pay later' }));
  });

  it('reads the old names rule-ignore and rule-todo as rule-exception and rule-debt', () => {
    const markers = findMarkers('a.py', lines('# rule-ignore: one -- a', '', '# rule-todo: two -- b'));

    expect(markers.map((m) => [m.kind, m.ruleId])).toEqual([['exception', 'one'], ['debt', 'two']]);
  });

  it('reads rule ids with dots and underscores', () => {
    const [marker] = findMarkers('q.sql', '-- rule-debt: sql.no_select_star -- list the columns');

    expect(marker.ruleId).toBe('sql.no_select_star');
  });

  it('goes on with the reason over the next comment lines of the same kind', () => {
    expect(reasons(lines(
      '# rule-exception: r -- the export writes CSV to stdout,',
      '#   so scripts can pipe it.',
      'print(row)'
    ))).toEqual(['the export writes CSV to stdout, so scripts can pipe it.']);
  });

  it('ends a line comment reason at a line that is not a comment of the same kind', () => {
    expect(reasons(lines('// rule-exception: r -- one', '# two', '// three'))).toEqual(['one']);
  });

  it('ends a reason at a comment line with no text, and at a blank line', () => {
    expect(reasons(lines('# rule-exception: r -- one', '#', '# two'))).toEqual(['one']);
    expect(reasons(lines('"""', 'rule-debt: r -- one', '', 'two', '"""'))).toEqual(['one']);
  });

  it('ends a reason at the next marker', () => {
    expect(reasons(lines('# rule-exception: a -- one', '# rule-debt: b -- two', '# three'))).toEqual(['one', 'two three']);
  });

  it('reads a marker in a docstring, with its reason up to the closing quotes', () => {
    const [marker] = findMarkers('a.py', lines(
      'def migrate(db):',
      '    """Copy the old tables into the new schema.',
      '',
      '    rule-debt: no-print -- the progress lines go to stdout for now.',
      '    Move them to logging when the job runner collects logs.',
      '    """'
    ));

    expect(marker).toEqual(expect.objectContaining({
      kind: 'debt',
      markerLine: 4,
      reason: 'the progress lines go to stdout for now. Move them to logging when the job runner collects logs.'
    }));
  });

  it('strips the leading * of block comment lines and keeps the text before the closer', () => {
    expect(reasons(lines(
      '/**',
      ' * rule-debt: r -- the retry count is fixed',
      ' * for now. Read it from config.',
      ' */'
    ))).toEqual(['the retry count is fixed for now. Read it from config.']);
    expect(reasons(lines(
      '<!-- rule-exception: r -- 80 is the width of the name',
      '     column in the user table. -->',
      'more text'
    ))).toEqual(['80 is the width of the name column in the user table.']);
  });

  it('ends the reason where the comment closes on the marker line', () => {
    expect(reasons(lines('/* rule-exception: r -- one */', 'two'))).toEqual(['one']);
  });

  it('leaves the reason undefined when it is missing or empty', () => {
    expect(reasons(lines(
      'code();',
      '// rule-exception: one',
      '// rule-exception: two --',
      '/* rule-exception: three -- */',
      '<!-- rule-exception: four -->',
      'x();'
    ))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('needs the reason to start on the marker line', () => {
    expect(reasons(lines('# rule-exception: r --', '# the reason, too late'))).toEqual([undefined]);
  });

  it('ignores marker text after code or in the middle of a sentence', () => {
    const content = lines(
      'const s = "// rule-exception: one -- inside a string";',
      'print("done")  # rule-exception: two -- after code',
      '# To accept it, write rule-exception: three -- and a reason.'
    );

    expect(findMarkers('a.ts', content)).toEqual([]);
  });

  it('does not take placeholders like <rule-id> for a rule id', () => {
    expect(findMarkers('a.md', lines('text', '# rule-exception: <rule-id> -- <reason>'))).toEqual([]);
  });
});

describe('namedMarker', () => {
  const marker: Marker = { kind: 'exception', ruleId: 'r', reason: 'why', file: 'src/a.ts', markerLine: 10 };

  it('finds the marker at the place a covered_by names', () => {
    expect(markerPlace(marker)).toBe('src/a.ts:10');
    expect(namedMarker([marker], 'src/a.ts:10')).toBe(marker);
    expect(namedMarker([marker], ' ./src/a.ts:10 ')).toBe(marker);
  });

  it('finds no marker at another place, or in a value that is not a place', () => {
    expect(namedMarker([marker], 'src/a.ts:11')).toBeUndefined();
    expect(namedMarker([marker], 'src/b.ts:10')).toBeUndefined();
    expect(namedMarker([marker], 'src/a.ts')).toBeUndefined();
    expect(namedMarker([marker], 10)).toBeUndefined();
    expect(namedMarker([marker], undefined)).toBeUndefined();
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
