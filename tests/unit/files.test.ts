import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePaths, readContents } from '../../src/files.js';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe('File Resolution and Traversal', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should read a single file correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 100 } as any);
    vi.mocked(fs.readFileSync).mockReturnValue('fake content');

    const paths = resolvePaths('src/test.ts');
    expect(paths).toEqual([expect.stringContaining('src/test.ts')]);
    
    const result = readContents(paths);
    expect(result.type).toBe('files');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('src/test.ts');
    expect(result.files[0].content).toBe('fake content');
  });

  it('should skip a file if it exceeds the size limit', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 2 * 1024 * 1024 } as any); // 2MB
    
    const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => {
      resolvePaths('src/huge.ts');
    }).toThrow('No valid files found or all files were ignored.');
    
    expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('File size limit exceeded'));
    consoleWarnMock.mockRestore();
  });

  it('should ignore configured directories like node_modules', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockImplementation((p: any) => {
      const pathStr = String(p);
      if (pathStr.includes('node_modules')) {
        return { isDirectory: () => true, isFile: () => false, size: 0 } as any;
      }
      return { isDirectory: () => false, isFile: () => true, size: 100 } as any;
    });

    expect(() => {
      resolvePaths('node_modules'); // Should skip it, resulting in 0 files found
    }).toThrow('No valid files found or all files were ignored.');

    expect(fs.readdirSync).not.toHaveBeenCalled();
  });
});
