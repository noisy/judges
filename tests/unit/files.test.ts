import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFiles } from '../../src/files.js';
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

    const result = readFiles('src/test.ts');
    expect(result).toContain('--- File: src/test.ts ---');
    expect(result).toContain('fake content');
  });

  it('should skip a file if it exceeds the size limit', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 2 * 1024 * 1024 } as any); // 2MB
    
    // Process should exit because no valid files are found, so we mock process.exit
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

    readFiles('src/huge.ts');
    
    expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('File size limit exceeded'));
    expect(exitMock).toHaveBeenCalledWith(1);
    
    exitMock.mockRestore();
    consoleErrorMock.mockRestore();
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

    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    readFiles('node_modules'); // Should skip it, resulting in 0 files found

    expect(fs.readdirSync).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);

    exitMock.mockRestore();
    consoleErrorMock.mockRestore();
  });
});
