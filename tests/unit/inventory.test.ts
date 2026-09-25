import { describe, it, expect } from 'vitest';
import { groupByRule, formatInventory } from '../../src/inventory.js';
import { findMarkers } from '../../src/markers.js';
import { parseArgs } from '../../src/config.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const markers = [
  ...findMarkers('src/a.ts', '// rule-todo: zeta -- legacy module\nx\n// rule-ignore: alpha -- external key\ny'),
  ...findMarkers('src/b.py', 'x\n# rule-ignore: zeta\ny'),
];

describe('groupByRule', () => {
  it('groups markers by rule id, sorted by id, keeping every marker field', () => {
    const groups = groupByRule(markers);

    expect(groups.map((g) => [g.ruleId, g.markers.length])).toEqual([['alpha', 1], ['zeta', 2]]);
    expect(groups[0].markers[0]).toEqual({
      kind: 'ignore', ruleId: 'alpha', reason: 'external key', file: 'src/a.ts', markerLine: 3, scope: { line: 4 }
    });
  });
});

describe('formatInventory', () => {
  it('lists kind, file:line and reason under each rule', () => {
    expect(plain(formatInventory(groupByRule(markers)))).toBe([
      'alpha (1)',
      '  ignore src/a.ts:3  external key',
      '',
      'zeta (2)',
      '  todo   src/a.ts:1 (whole file)  legacy module',
      '  ignore src/b.py:2  (no reason)',
      ''
    ].join('\n'));
  });

  it('says so when there are no markers', () => {
    expect(formatInventory([])).toBe('No markers found.\n');
  });
});

describe('parseArgs markers command', () => {
  it('reads `markers` as the inventory command with its paths', () => {
    const config = parseArgs(['markers', 'src', '--json']);

    expect(config).toEqual(expect.objectContaining({ command: 'markers', paths: ['src'], json: true }));
  });
});
