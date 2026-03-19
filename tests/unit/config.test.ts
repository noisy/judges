import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/config.js';

describe('CLI Configuration Parsing', () => {
  it('should parse default boolean flags correctly', () => {
    const args = parseArgs([]);
    expect(args.json).toBe(false);
    expect(args.short).toBe(false);
    expect(args.full).toBe(false);
    expect(args.staged).toBe(false);
    expect(args.diff).toBe(false);
    expect(args.help).toBe(false);
    expect(args.visibleIssueLimit).toBe(3); // DEFAULT_MAX_ISSUES_TO_SHOW
  });

  it('should parse explicit boolean flags', () => {
    const args = parseArgs(['--json', '--staged', '--short']);
    expect(args.json).toBe(true);
    expect(args.staged).toBe(true);
    expect(args.short).toBe(true);
    expect(args.visibleIssueLimit).toBe(0); // --short overrides limit to 0
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
});
