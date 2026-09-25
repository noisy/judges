import { describe, it, expect } from 'vitest';
import { parseArgs, inputUsageError, ROOT_NEEDS_FILE_INPUT } from '../../src/config.js';

describe('CLI Configuration Parsing', () => {
  it('should parse default boolean flags correctly', () => {
    const args = parseArgs([]);
    expect(args.json).toBe(false);
    expect(args.short).toBe(false);
    expect(args.full).toBe(false);
    expect(args.staged).toBe(false);
    expect(args.diff).toBe(false);
    expect(args.help).toBe(false);
    expect(args.engine).toBe('claude'); // Default engine
    expect(args.visibleIssueLimit).toBe(3); // DEFAULT_MAX_ISSUES_TO_SHOW
  });

  it('should parse explicit boolean flags', () => {
    const args = parseArgs(['--json', '--staged', '--short', '--version']);
    expect(args.json).toBe(true);
    expect(args.staged).toBe(true);
    expect(args.short).toBe(true);
    expect(args.version).toBe(true);
    expect(args.visibleIssueLimit).toBe(0); // --short overrides limit to 0
  });

  it('should collect repeated --only ids', () => {
    expect(parseArgs([]).only).toEqual([]);
    expect(parseArgs(['--only', 'a']).only).toEqual(['a']);
    expect(parseArgs(['--only', 'a', '--only', 'b']).only).toEqual(['a', 'b']);
  });

  it('should parse the --top option', () => {
    const args = parseArgs(['--top', '5']);
    expect(args.visibleIssueLimit).toBe(5);
  });

  it('should parse positional directory paths', () => {
    const args = parseArgs(['src/', '.', '--json']);
    expect(args.paths).toEqual(['src/', '.']);
    expect(args.json).toBe(true);
  });

  it('should prioritize --short over --full if both are provided', () => {
    // According to current logic, `short` is checked first.
    const args = parseArgs(['--short', '--full']);
    expect(args.visibleIssueLimit).toBe(0);
  });

  it('should parse the --fail-on flag', () => {
    let args = parseArgs(['--fail-on', 'high']);
    expect(args.failOn).toBe('high');

    args = parseArgs(['--fail-on', 'MED']);
    expect(args.failOn).toBe('medium');
  });

  it('should parse the --last-commit flag', () => {
    const args = parseArgs(['--last-commit']);
    expect(args.lastCommit).toBe(true);
  });

  it('should parse the --engine flag', () => {
    let args = parseArgs(['--engine', 'codex']);
    expect(args.engine).toBe('codex');

    args = parseArgs(['--engine', 'unknown']);
    expect(args.engine).toBe('claude'); // Fallback to default
  });

  it('should collect repeatable --rules directories', () => {
    expect(parseArgs([]).ruleDirs).toEqual([]);
    expect(parseArgs(['--rules', 'rules']).ruleDirs).toEqual(['rules']);
    expect(parseArgs(['--rules', 'rules', '--rules', 'shared/rules']).ruleDirs).toEqual(['rules', 'shared/rules']);
  });
});

describe('inputUsageError', () => {
  it.each([[['--root', 'fixture']], [['--root', 'fixture', '--staged']], [['--root', 'fixture', '--diff']],
    [['--root', 'fixture', '--last-commit']]])('rejects --root with diff input: %j', (argv) => {
    expect(inputUsageError(parseArgs(argv))).toBe(ROOT_NEEDS_FILE_INPUT);
  });

  it('accepts --root with file input, and no --root at all', () => {
    expect(inputUsageError(parseArgs(['--root', 'fixture', 'fixture/src/a.py']))).toBeUndefined();
    expect(inputUsageError(parseArgs(['--root', 'fixture', '-f', 'fixture/src/a.py']))).toBeUndefined();
    expect(inputUsageError(parseArgs(['--staged']))).toBeUndefined();
  });
});

