import { describe, it, expect } from 'vitest';
import { validateJudge } from '../../src/validator.js';

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
