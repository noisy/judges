import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadJudges, selectJudges, ruleDirectory, ruleFileName, Judge } from '../../src/judges.js';
import { UsageError } from '../../src/config.js';

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
      mode: 'one-shot', timeout_seconds: 30, scope: ['**/*'], severity: 'medium', tools: [],
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
      .toThrow(UsageError);
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

  it('keeps a rule whose frontmatter is not valid YAML, marked invalid', () => {
    const rulesDir = writeFile('rules/booleans.md', '---\nid: booleans\nscope: ["src/**\n---\nBody.');
    const [rule] = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });

    expect(rule).toMatchObject({ id: 'booleans', isValid: false });
    expect(rule.validationErrors.join(' ')).toContain('cannot read the frontmatter');
  });

  it('keeps a rule with `check` or `command` as invalid, next to a valid one', () => {
    writeFile('rules/lint.md', '---\nid: lint\ncommand: npm run lint\n---\n');
    const rulesDir = writeFile('rules/booleans.md', '---\nid: booleans\n---\nBody.');
    const judges = loadJudges({ legacyDirs: [], ruleDirs: [rulesDir] });
    const lint = judges.find((judge) => judge.id === 'lint');

    expect(judges.find((judge) => judge.id === 'booleans')?.isValid).toBe(true);
    expect(lint?.isValid).toBe(false);
    expect(lint?.validationErrors.join(' ')).toContain('`command` is not a rule field');
  });
});

describe('loadJudges with rule directories', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Sorted, since the order of a directory listing depends on the file system.
  function load(): Judge[] {
    return loadJudges({ legacyDirs: [], ruleDirs: [path.join(root, 'rules')] }).sort((a, b) => a.id.localeCompare(b.id));
  }

  it('loads <id>/RULE.md with the directory name as id, next to a rule file', () => {
    writeFile('rules/no-print/RULE.md', '---\nid: no-print\n---\nNo print.');
    writeFile('rules/booleans.md', '---\nid: booleans\n---\nBooleans.');
    const judges = load();

    expect(judges.map(({ id, isValid, instructions }) => ({ id, isValid, instructions }))).toEqual([
      { id: 'booleans', isValid: true, instructions: 'Booleans.' },
      { id: 'no-print', isValid: true, instructions: 'No print.' },
    ]);
    expect(ruleDirectory(judges[1])).toBe(path.join(root, 'rules', 'no-print'));
    expect(ruleFileName(judges[1])).toBe(path.join('no-print', 'RULE.md'));
    expect(ruleDirectory(judges[0])).toBeUndefined();
  });

  it('marks a RULE.md invalid when its id does not match the directory name', () => {
    writeFile('rules/todo-has-issue/RULE.md', '---\nid: todo-has-issues\n---\nBody.');
    const [rule] = load();

    expect(rule).toMatchObject({ id: 'todo-has-issue', isValid: false });
    expect(rule.validationErrors).toContain('error: `id` "todo-has-issues" must match the directory name "todo-has-issue"');
  });

  it('reports a directory without RULE.md as an invalid rule and never loads the .md files inside it', () => {
    writeFile('rules/no-magic-numbers/no-magic-numbers.md', '---\nid: no-magic-numbers\n---\nBody.');
    writeFile('rules/no-print/RULE.md', '---\nid: no-print\n---\nBody.');
    writeFile('rules/no-print/tests/prints-greeting.md', '---\nexpect: findings\n---\nA test.');
    const judges = load();

    expect(judges.map(({ id, isValid }) => ({ id, isValid }))).toEqual([
      { id: 'no-magic-numbers', isValid: false }, { id: 'no-print', isValid: true },
    ]);
    expect(judges[0].validationErrors.join(' ')).toContain('`RULE.md` is missing');
  });

  it('ignores hidden directories', () => {
    writeFile('rules/.cache/notes.md', 'not a rule');
    expect(load()).toEqual([]);
  });

  it('refuses a file and a directory with the same id in one rules directory, naming both', () => {
    const file = path.join(writeFile('rules/no-print.md', '---\nid: no-print\n---\nBody.'), 'no-print.md');
    const directory = path.join(writeFile('rules/no-print/RULE.md', '---\nid: no-print\n---\nBody.'), 'RULE.md');

    expect(load).toThrow(UsageError);
    expect(load).toThrow(file);
    expect(load).toThrow(directory);
  });

  it('lets a rule directory in a later rules directory override a rule file', () => {
    writeFile('team/no-print.md', '---\nid: no-print\n---\nTeam.');
    writeFile('project/no-print/RULE.md', '---\nid: no-print\n---\nProject.');
    const judges = loadJudges({ legacyDirs: [], ruleDirs: [path.join(root, 'team'), path.join(root, 'project')] });

    expect(judges.map(({ id, instructions }) => ({ id, instructions }))).toEqual([{ id: 'no-print', instructions: 'Project.' }]);
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
    expect(() => selectJudges(judges, ['a', 'x', 'y'])).toThrow(new UsageError('Unknown judge or rule id: x, y'));
  });
});
