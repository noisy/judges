import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadJudges, selectJudges, Judge } from '../../src/judges.js';

let root: string;

function writeFile(relativePath: string, content: string): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return path.dirname(filePath);
}

const LEGACY_JUDGE = `---
name: Naming
description: Checks names
version: 1.0.0
---
Legacy instructions.`;

const RULE = `---
id: one-call-per-connector
scope: ["src/connectors/**/*.py"]
severity: high
check: judge
model: small
budget: 30s, $0.10
---
Intent: a connector is a thin adapter to one external service.`;

describe('loadJudges', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads legacy JUDGE.md judges with schema defaults', () => {
    writeFile('legacy/naming/JUDGE.md', LEGACY_JUDGE);
    const [judge] = loadJudges({ legacyDirs: [path.join(root, 'legacy')], ruleDirs: [] });

    expect(judge).toMatchObject({
      id: 'naming', name: 'Naming', version: '1.0.0', format: 'judge-md', isValid: true,
      mode: 'one-shot', timeout_seconds: 30, scope: ['**/*'], severity: 'medium', check: 'judge', tools: [],
      instructions: 'Legacy instructions.',
    });
  });

  it('skips missing legacy directories silently', () => {
    expect(loadJudges({ legacyDirs: [path.join(root, 'nope')], ruleDirs: [] })).toEqual([]);
  });

  it('loads flat rule files with parsed budget and name defaulting to id', () => {
    const rulesDir = writeFile('rules/one-call-per-connector.md', RULE);
    const [rule] = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });

    expect(rule).toMatchObject({
      id: 'one-call-per-connector', name: 'one-call-per-connector', format: 'rule', isValid: true,
      scope: ['src/connectors/**/*.py'], severity: 'high', model: 'small',
      timeout_seconds: 30, max_budget_usd: 0.1, description: '', version: '',
    });
    expect(rule.instructions).toContain('Intent:');
  });

  it('ignores non-markdown files in rule directories', () => {
    const rulesDir = writeFile('rules/README.txt', 'not a rule');
    expect(loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] })).toEqual([]);
  });

  it('throws when an explicit rules directory does not exist', () => {
    expect(() => loadJudges({ legacyDirs: [], ruleDirs: [path.join(root, 'nope')] }))
      .toThrow('Rules directory not found');
  });

  it('lets rules override legacy judges with the same id', () => {
    writeFile('legacy/naming/JUDGE.md', LEGACY_JUDGE);
    const rulesDir = writeFile('rules/naming.md', '---\nid: naming\n---\nRule instructions.');
    const judges = loadJudges({ legacyDirs: [path.join(root, 'legacy')], ruleDirs: [rulesDir] });

    expect(judges).toHaveLength(1);
    expect(judges[0]).toMatchObject({ format: 'rule', instructions: 'Rule instructions.' });
  });

  it('marks a rule invalid when its id does not match the file name', () => {
    const rulesDir = writeFile('rules/booleans.md', '---\nid: something-else\n---\nBody.');
    const [rule] = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });

    expect(rule.isValid).toBe(false);
    expect(rule.id).toBe('booleans');
    expect(rule.validationErrors.join(' ')).toContain('must match the file name');
  });

  it('marks a rule invalid on an unknown severity, keeping default settings', () => {
    const rulesDir = writeFile('rules/booleans.md', '---\nid: booleans\nseverity: critical\n---\nBody.');
    const [rule] = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });

    expect(rule.isValid).toBe(false);
    expect(rule.validationErrors.join(' ')).toContain('severity');
    expect(rule).toMatchObject({ name: 'booleans', timeout_seconds: 30, severity: 'medium' });
  });

  it('loads a deterministic rule with a command and no body', () => {
    const rulesDir = writeFile('rules/lint.md', '---\nid: lint\ncheck: deterministic\ncommand: npm run lint\n---\n');
    const [rule] = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });

    expect(rule).toMatchObject({ isValid: true, check: 'deterministic', command: 'npm run lint', instructions: '' });
  });
});

describe('selectJudges', () => {
  const judges = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Judge[];

  it('keeps every judge when no ids are given', () => {
    expect(selectJudges(judges, [])).toEqual(judges);
  });

  it('keeps only the named judges', () => {
    expect(selectJudges(judges, ['c', 'a']).map(j => j.id)).toEqual(['a', 'c']);
  });

  it('throws naming every unknown id', () => {
    expect(() => selectJudges(judges, ['a', 'x', 'y'])).toThrow('Unknown judge or rule id: x, y');
  });
});
