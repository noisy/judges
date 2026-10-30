import { describe, it, expect } from 'vitest';
import { validateJudge, validateRule, parseBudget } from '../../src/validator.js';

describe('Zod Schema Frontend Validation (`validateJudge`)', () => {
  it('should accept a completely valid configuration', () => {
    const data = {
      name: 'Test Judge',
      description: 'Finds bad test cases',
      version: '1.2.3',
      mode: 'one-shot',
      timeout_seconds: 60,
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.data.name).toBe('Test Judge');
    expect(result.data.timeout_seconds).toBe(60);
  });

  it('should apply default values for optional fields', () => {
    const data = {
      name: 'Minimal Judge',
      description: 'Does something minimal',
      version: 'v0.0.1', // "v" prefix should be valid 
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(true);
    expect(result.data.mode).toBe('one-shot');
    expect(result.data.timeout_seconds).toBe(30);
  });

  it('should reject when required fields are missing', () => {
    const data = {
      version: '1.0.0',
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(false);
    
    const errString = result.errors.join(' | ');
    expect(errString).toContain('name');
    expect(errString).toContain('description');
    expect(errString).toContain('expected string, received undefined');
  });

  it('should strictly reject invalid semver version strings', () => {
    const data = {
      name: 'Test',
      description: 'Test desc',
      version: 'not-a-number', 
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error: `version` must be a valid semver');
  });

  it('should catch unrecognized mode values', () => {
    const data = {
      name: 'Test',
      description: 'Test desc',
      version: '1.0.0',
      mode: 'unsupported-mode' 
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid option');
  });

  it('should keep agent mode without warnings', () => {
    const data = {
      name: 'Agent Judge',
      description: 'Operates as an agent',
      version: '2.0.0',
      mode: 'agent' 
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.data.mode).toBe('agent');
  });

  it('should strictly reject invalid timeout seconds', () => {
    const data = {
      name: 'Test',
      description: 'Test desc',
      version: '1.0.0',
      timeout_seconds: -5  // must be positive
    };
    
    let result = validateJudge(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`timeout_seconds` must be positive');

    data.timeout_seconds = 2.5; // must be integer
    result = validateJudge(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`timeout_seconds` must be an integer');
  });
});

describe('parseBudget', () => {
  it.each([
    ['30s, $0.10', { timeout_seconds: 30, max_budget_usd: 0.1 }],
    ['2m', { timeout_seconds: 120 }],
    ['$1.5', { max_budget_usd: 1.5 }],
    ['$0.10, 45s', { timeout_seconds: 45, max_budget_usd: 0.1 }],
  ])('parses %s', (input, expected) => {
    expect(parseBudget(input)).toEqual(expected);
  });

  it.each(['', '30', '30h', '0s', '$0', '30s, 40s', '30s,', 'ten seconds'])('rejects %j', (input) => {
    expect(parseBudget(input)).toBeNull();
  });
});

describe('validateRule', () => {
  it('should accept a minimal rule and apply defaults', () => {
    const result = validateRule({ id: 'booleans' }, 'booleans');
    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({
      name: 'booleans', description: '', version: '', scope: ['**/*'], severity: 'medium',
      check: 'judge', tools: [], allow_read: [], timeout_seconds: 30, mode: 'one-shot', context: 'file',
    });
  });

  it('should require an id', () => {
    const result = validateRule({ severity: 'high' }, 'booleans');
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('id');
  });

  it('should reject an id that does not match the file name', () => {
    const result = validateRule({ id: 'other' }, 'booleans');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error: `id` "other" must match the file name "booleans"');
  });

  it('should take timeout_seconds from budget', () => {
    const result = validateRule({ id: 'r', budget: '2m, $0.50' }, 'r');
    expect(result.data).toMatchObject({ timeout_seconds: 120, max_budget_usd: 0.5 });
    expect(result.data).not.toHaveProperty('budget');
  });

  it('should reject a malformed budget', () => {
    const result = validateRule({ id: 'r', budget: 'fast' }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`budget` must look like');
  });

  it('should reject budget time together with timeout_seconds', () => {
    const result = validateRule({ id: 'r', budget: '30s', timeout_seconds: 10 }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('cannot both be set');
  });

  it('should allow budget cost together with timeout_seconds', () => {
    const result = validateRule({ id: 'r', budget: '$0.10', timeout_seconds: 10 }, 'r');
    expect(result.data).toMatchObject({ timeout_seconds: 10, max_budget_usd: 0.1 });
  });

  it('should reject a command on a judge rule', () => {
    const result = validateRule({ id: 'r', command: 'npm test' }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('only allowed with `check: deterministic`');
  });

  it('should reject non-positive max_turns', () => {
    const result = validateRule({ id: 'r', max_turns: 0 }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`max_turns` must be positive');
  });
});

describe('context', () => {
  it.each([
    [{}, 'file', 'one-shot'],
    [{ context: 'diff' }, 'diff', 'one-shot'],
    [{ context: 'repo' }, 'repo', 'agent'],
    [{ mode: 'one-shot' }, 'file', 'one-shot'],
    [{ mode: 'agent' }, 'repo', 'agent'],
    [{ mode: 'one-shot', context: 'diff' }, 'diff', 'one-shot'],
    [{ mode: 'agent', context: 'repo' }, 'repo', 'agent'],
  ])('resolves %j to context %s, run as %s', (fields, context, mode) => {
    const result = validateRule({ id: 'r', ...fields }, 'r');
    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({ context, mode });
  });

  it('gives a repo rule the agent defaults', () => {
    const result = validateRule({ id: 'r', context: 'repo' }, 'r');
    expect(result.data).toMatchObject({ tools: ['Read', 'Grep', 'Glob'], max_turns: 8, timeout_seconds: 120 });
  });

  it('rejects an unknown context', () => {
    const result = validateRule({ id: 'r', context: 'function' }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error: `context` must be one of: diff, file, module, repo');
  });

  it('rejects module, which is not supported yet', () => {
    const result = validateRule({ id: 'r', context: 'module' }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['error: `context: module` is not supported yet']);
  });

  it.each([
    ['one-shot', 'repo'],
    ['agent', 'diff'],
    ['agent', 'file'],
  ])('rejects mode: %s with context: %s, since it does not guess which one is meant', (mode, context) => {
    const result = validateRule({ id: 'r', mode, context }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([`error: \`context: ${context}\` contradicts \`mode: ${mode}\`; set only \`context\``]);
  });

  it.each([
    ['tools', ['Read']],
    ['max_turns', 3],
    ['allow_read', ['../shared/**']],
  ])('rejects %s on a diff or file rule, which has no tools', (field, value) => {
    for (const context of ['diff', 'file']) {
      const result = validateRule({ id: 'r', context, [field]: value }, 'r');
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([`error: \`${field}\` is only allowed with \`context: repo\` (or \`mode: agent\`)`]);
    }
  });

  it('accepts tools, max_turns and allow_read on a repo rule', () => {
    const result = validateRule({ id: 'r', context: 'repo', tools: ['Grep'], max_turns: 3, allow_read: ['../shared/**'] }, 'r');
    expect(result.valid).toBe(true);
  });
});

describe('mode and tools', () => {
  it('gives an agent read-only tools, a turn cap and a longer timeout by default', () => {
    const result = validateRule({ id: 'r', mode: 'agent' }, 'r');
    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({ tools: ['Read', 'Grep', 'Glob'], max_turns: 8, timeout_seconds: 120 });
  });

  it('keeps explicit agent settings and a budget time over the agent defaults', () => {
    const result = validateRule({ id: 'r', mode: 'agent', tools: ['Read'], max_turns: 3, budget: '90s, $0.25' }, 'r');
    expect(result.data).toMatchObject({ tools: ['Read'], max_turns: 3, timeout_seconds: 90, max_budget_usd: 0.25 });
  });

  it('gives a one-shot judge no tools and no turn cap', () => {
    const result = validateRule({ id: 'r' }, 'r');
    expect(result.data).toMatchObject({ tools: [], timeout_seconds: 30 });
    expect(result.data.max_turns).toBeUndefined();
  });

  it('rejects tools on a one-shot rule', () => {
    const result = validateRule({ id: 'r', tools: ['Read'] }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error: `tools` is only allowed with `context: repo` (or `mode: agent`)');
  });

  it.each(['Write', 'Edit', 'Bash', 'WebFetch', 'LS'])('rejects the non-read-only tool %s on any rule', (tool) => {
    const result = validateRule({ id: 'r', mode: 'agent', tools: ['Read', tool] }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`tools` entries must be read-only tools: Read, Grep, Glob');
  });

  it('rejects an empty tool list for an agent', () => {
    const result = validateRule({ id: 'r', mode: 'agent', tools: [] }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('`tools` cannot be empty');
  });

  it('lets an agent read nothing outside the repo by default', () => {
    expect(validateRule({ id: 'r', mode: 'agent' }, 'r').data.allow_read).toEqual([]);
  });

  it.each(['../billing-service/**', '../shared-contracts', '/srv/specs/**', '~/contracts/**', '../a/b/'])(
    'accepts the directory pattern %s', (pattern) => {
      expect(validateRule({ id: 'r', mode: 'agent', allow_read: [pattern] }, 'r').valid).toBe(true);
    });

  it.each(['../billing/*.py', '../billing/**/api.py', '../{a,b}/**', '../billing/api?.py'])(
    'rejects the narrower glob %s, since the sandbox grants whole directories', (pattern) => {
      const result = validateRule({ id: 'r', mode: 'agent', allow_read: [pattern] }, 'r');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('`allow_read` entries must be a directory');
    });

  it('rejects allow_read on a one-shot rule', () => {
    const result = validateRule({ id: 'r', allow_read: ['../billing-service/**'] }, 'r');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error: `allow_read` is only allowed with `context: repo` (or `mode: agent`)');
  });

  it('applies the same checks to JUDGE.md judges', () => {
    const result = validateJudge({ name: 'j', description: 'd', version: '1.0.0', tools: ['Bash'] });
    expect(result.valid).toBe(false);
  });
});
