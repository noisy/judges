import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractDiff } from '../../src/diff.js';
import * as child_process from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

describe('Diff Extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use git diff HEAD by default (head mode)', () => {
    vi.mocked(child_process.execSync).mockReturnValue('mock diff content');
    const result = extractDiff();
    
    expect(child_process.execSync).toHaveBeenCalledWith('git diff HEAD', expect.any(Object));
    expect(result).toBe('mock diff content');
  });

  it('should use git diff --cached in staged mode', () => {
    vi.mocked(child_process.execSync).mockReturnValue('mock staged diff');
    const result = extractDiff('staged');
    
    expect(child_process.execSync).toHaveBeenCalledWith('git diff --cached', expect.any(Object));
    expect(result).toBe('mock staged diff');
  });

  it('should use git diff in diff mode', () => {
    vi.mocked(child_process.execSync).mockReturnValue('mock uncommited diff');
    const result = extractDiff('diff');
    
    expect(child_process.execSync).toHaveBeenCalledWith('git diff', expect.any(Object));
    expect(result).toBe('mock uncommited diff');
  });

  it('should return a friendly string if diff is empty', () => {
    vi.mocked(child_process.execSync).mockReturnValue(' \n ');
    const result = extractDiff('staged');
    
    expect(result).toContain('No git diff found');
  });
});
