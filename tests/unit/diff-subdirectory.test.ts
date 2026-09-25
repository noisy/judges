import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractDiff } from '../../src/diff.js';

const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, stdio: 'pipe' });

describe('diff mode run from a subdirectory', () => {
  let tmp: string;
  let repo: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-diff-')));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    git(repo, 'init -q');
    git(repo, 'config user.email test@example.com');
    git(repo, 'config user.name test');
    fs.writeFileSync(path.join(repo, 'README.md'), 'readme\n');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'a\n');
    git(repo, 'add -A');
    git(repo, 'commit -q -m init');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    git(repo, 'reset -q --hard');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads working-tree content from the repository root', () => {
    fs.writeFileSync(path.join(repo, 'README.md'), 'readme changed\n');
    process.chdir(path.join(repo, 'src'));

    expect(extractDiff('diff').files).toEqual([{ path: 'README.md', content: 'readme changed\n' }]);
  });

  it('reads staged content from the git tree', () => {
    fs.writeFileSync(path.join(repo, 'README.md'), 'readme staged\n');
    git(repo, 'add README.md');
    process.chdir(path.join(repo, 'src'));

    expect(extractDiff('staged').files).toEqual([{ path: 'README.md', content: 'readme staged\n' }]);
  });

  it('reads last-commit content from the git tree', () => {
    fs.writeFileSync(path.join(repo, 'README.md'), 'readme committed\n');
    git(repo, 'commit -q -am change');
    process.chdir(path.join(repo, 'src'));

    expect(extractDiff('last-commit').files).toEqual([{ path: 'README.md', content: 'readme committed\n' }]);
  });
});
