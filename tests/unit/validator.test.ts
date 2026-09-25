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

  it('should produce a non-fatal warning and fallback to one-shot when mode is agent', () => {
    const data = {
      name: 'Agent Judge',
      description: 'Operates as an agent',
      version: '2.0.0',
      mode: 'agent' 
    };
    
    const result = validateJudge(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('agent mode not yet implemented, falling back to one-shot');
    expect(result.data.mode).toBe('one-shot'); // Forced fallback mechanism
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
      check: 'judge', tools: [], timeout_seconds: 30, mode: 'one-shot',
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
