import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractDiff } from '../../src/diff.js';
import { UsageError } from '../../src/config.js';

const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, stdio: 'pipe' });

describe('base mode: the branch change since it left the base', () => {
  let tmp: string;
  let repo: string;
  const originalCwd = process.cwd();

  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  const commit = (message: string) => {
    git(repo, 'add -A');
    git(repo, `commit -q --allow-empty -m ${message}`);
  };
  const changedFiles = (baseRef: string) => extractDiff('base', baseRef).files;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-base-')));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init -q -b main');
    git(repo, 'config user.email test@example.com');
    git(repo, 'config user.name test');
    write('src/cart.py', 'cart\n');
    write('src/greet.py', 'greet\n');
    commit('base');
    git(repo, 'checkout -q -b feature');
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves out what main got after the branch point and what is not committed', () => {
    write('src/cart.py', 'cart committed\n');
    commit('branch');
    git(repo, 'checkout -q main');
    write('src/greet.py', 'greet on main\n');
    commit('main-moved-on');
    git(repo, 'checkout -q feature');
    write('src/cart.py', 'cart on disk\n');

    expect(changedFiles('main')).toEqual([{ path: 'src/cart.py', content: 'cart committed\n' }]);
  });

  it('reviews all branch commits as one net change', () => {
    write('src/cart.py', 'cart changed\n');
    write('src/greet.py', 'greet\nprint()\n');
    commit('first');
    write('src/discount.py', 'discount\n');
    write('src/greet.py', 'greet\n');
    commit('second');

    expect(changedFiles('main').map(f => f.path)).toEqual(['src/cart.py', 'src/discount.py']);
  });

  it('keeps the new path of a moved file and skips a deleted one, from a subdirectory', () => {
    fs.renameSync(path.join(repo, 'src/greet.py'), path.join(repo, 'src/hello.py'));
    fs.rmSync(path.join(repo, 'src/cart.py'));
    write('tools/run.py', 'run\n');
    commit('move');
    process.chdir(path.join(repo, 'tools'));

    expect(changedFiles('HEAD~1')).toEqual([
      { path: 'src/hello.py', content: 'greet\n' },
      { path: 'tools/run.py', content: 'run\n' },
    ]);
  });

  it('rejects a ref that does not resolve, naming it', () => {
    write('src/cart.py', 'cart changed\n');
    commit('branch');

    expect(() => changedFiles('mian')).toThrow(UsageError);
    expect(() => changedFiles('mian')).toThrow(/'mian'/);
  });

  it('rejects a branch with no change since the base', () => {
    commit('empty');

    expect(() => changedFiles('main')).toThrow(UsageError);
    expect(() => changedFiles('main')).toThrow(/No changes on this branch since it left 'main'/);
  });
});
