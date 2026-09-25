import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { repoRoot, readContents } from '../../src/files.js';

describe('repoRoot', () => {
  let tmp: string;
  let repo: string;
  let outside: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-root-')));
    repo = path.join(tmp, 'repo');
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(outside);
    execSync('git init -q', { cwd: repo });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'x');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('finds the repository root from a subdirectory', () => {
    expect(repoRoot(path.join(repo, 'src'))).toBe(repo);
  });

  it('falls back to the directory itself outside a repository', () => {
    expect(repoRoot(outside)).toBe(outside);
  });

  it('lets readContents name files relative to the repository root', () => {
    const context = readContents([path.join(repo, 'src', 'a.ts')], repoRoot(path.join(repo, 'src')));

    expect(context.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });
});
