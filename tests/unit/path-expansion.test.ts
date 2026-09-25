import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePaths, readContents } from '../../src/files.js';

const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, stdio: 'pipe' });

function write(root: string, file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

function relativeTo(root: string, files: string[]): string[] {
  return files.map((file) => path.relative(root, file)).sort();
}

describe('input paths inside a git repository', () => {
  let tmp: string;
  let repo: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-paths-')));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init -q');
    git(repo, 'config user.email test@example.com');
    git(repo, 'config user.name test');
    write(repo, '.gitignore', 'ignored.json\nbuild/\n');
    write(repo, 'README.md', 'readme\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    write(repo, 'src/logo.png', Buffer.from([0x89, 0x50, 0x00, 0x01]));
    git(repo, 'add -A');
    git(repo, 'commit -q -m init');
    write(repo, 'src/untracked.ts', 'export const u = 1;\n');
    write(repo, 'ignored.json', '{"big": true}\n');
    write(repo, 'build/out.js', 'compiled\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('expands a directory to tracked and untracked-but-not-ignored files only', () => {
    const files = resolvePaths(repo, repo);

    expect(relativeTo(repo, files)).toEqual(['.gitignore', 'README.md', 'src/a.ts', 'src/untracked.ts']);
  });

  it('expands a subdirectory relative to the working directory', () => {
    const files = resolvePaths('.', path.join(repo, 'src'));

    expect(relativeTo(repo, files)).toEqual(['src/a.ts', 'src/untracked.ts']);
  });

  it('skips binary files found by expansion without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const context = readContents(resolvePaths(repo, repo), repo);

    expect(context.files.map((f) => f.path)).not.toContain('src/logo.png');
    expect(warn).not.toHaveBeenCalled();
  });

  it('still reads a file the user names explicitly, even an ignored one', () => {
    expect(relativeTo(repo, resolvePaths('ignored.json', repo))).toEqual(['ignored.json']);
  });

  it('keeps the binary warning for a binary file the user names explicitly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    readContents(resolvePaths('src/logo.png', repo), repo);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('binary'));
  });
});

describe('input paths outside a git repository', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-plain-')));
    write(dir, 'a.ts', 'a\n');
    write(dir, 'nested/b.ts', 'b\n');
    write(dir, 'node_modules/dep.js', 'dep\n');
    write(dir, 'image.bin', Buffer.from([0x00, 0x01]));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to a plain traversal that skips ignored directories and binaries', () => {
    expect(relativeTo(dir, resolvePaths(dir, dir))).toEqual(['a.ts', 'nested/b.ts']);
  });
});
