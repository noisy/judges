import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractDiff } from '../../src/diff.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

describe('diff mode with odd file names', () => {
  let tmp: string;
  let repo: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-diff-names-')));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, 'src', 'a.py'), 'a = 1\n');
    fs.writeFileSync(path.join(repo, 'src', 'old.py'), 'old = 1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    git(repo, 'reset', '-q', '--hard');
    git(repo, 'clean', '-q', '-fd');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads names with spaces and non-ASCII characters, from a subdirectory', () => {
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'docs', 'release notes.md'), 'notes\n');
    fs.writeFileSync(path.join(repo, 'docs', 'café.md'), 'café\n');
    git(repo, 'add', 'docs');
    process.chdir(path.join(repo, 'src'));

    expect(extractDiff('staged').files).toEqual([
      { path: 'docs/café.md', content: 'café\n' },
      { path: 'docs/release notes.md', content: 'notes\n' },
    ]);
  });

  it('reads a renamed file under its new name', () => {
    git(repo, 'mv', 'src/old.py', 'src/new name.py');
    process.chdir(repo);

    expect(extractDiff('staged').files).toEqual([{ path: 'src/new name.py', content: 'old = 1\n' }]);
  });
});
