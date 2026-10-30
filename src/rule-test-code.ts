import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Code, InvalidTest, TestFile } from './rule-test-spec.js';
import { readContents, repoRoot, walkDirectory } from './files.js';
import { splitDiffByFile } from './scope.js';
import { EvaluationContext } from './types.js';

// Set by git for a hook. They would point `git apply` at the repository the hook runs in, not at the copy.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

// Writes the code of a test into `root`, an empty directory, and returns what the rule reviews there.
// `root` must have a directory of its own around it: history tests keep a temporary index next to it.
export function prepareCode(code: Code, root: string): EvaluationContext {
  switch (code.from) {
    case 'repo':
      fs.cpSync(code.dir, root, { recursive: true });
      return code.patch === undefined ? audit(root) : applyPatch(root, code.patch);
    case 'files':
      writeFiles(root, code.files);
      return code.patch === undefined ? audit(root) : applyPatch(root, code.patch);
    case 'history':
      return reviewHistory(code.base, code.head, root);
    case 'commit':
      checkOut(repoRoot(), resolveCommit('commit', code.commit), root);
      return audit(root);
  }
}

function writeFiles(root: string, files: TestFile[]): void {
  for (const file of files) {
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
}

function audit(root: string): EvaluationContext {
  return { ...readContents(walkDirectory(root), root), root };
}

// The copy is no repository, and git must not take it for a part of one around it.
// --recount, because a patch written by hand in a Markdown file seldom has the right line counts.
function applyPatch(root: string, patch: string): EvaluationContext {
  try {
    execFileSync('git', ['apply', '--recount', '--whitespace=nowarn', '-'], {
      cwd: root, input: patch, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...withoutGitLocation(process.env), GIT_CEILING_DIRECTORIES: path.dirname(root) },
    });
  } catch (error: any) {
    throw new InvalidTest(`the patch does not apply: ${firstLine(error.stderr || error.message)}`);
  }
  return reviewOf(root, patch);
}

// `base...head` as a review sees it: the change on head since it left base, read from a checkout of head.
function reviewHistory(baseRef: string, headRef: string, root: string): EvaluationContext {
  const repo = repoRoot();
  const base = resolveCommit('base', baseRef);
  const head = resolveCommit('head', headRef);
  checkOut(repo, head, root);
  try {
    const rawDiff = git(repo, ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', `${base}...${head}`]);
    return reviewOf(root, rawDiff);
  } catch (error: any) {
    throw new InvalidTest(`cannot diff ${baseRef}...${headRef}: ${firstLine(error.stderr || error.message)}`);
  }
}

// The changed files as they are after the change; a deleted file has nothing left to review.
function reviewOf(root: string, rawDiff: string): EvaluationContext {
  const changed = [...new Set(splitDiffByFile(rawDiff).map((section) => section.path))]
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  return { ...readContents(changed, root), type: 'diff', rawDiff, root };
}

// A temporary index exports the commit without touching the working tree, the index or the checked-out branch.
function checkOut(repo: string, commit: string, root: string): void {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(path.dirname(root), 'index') };
  git(repo, ['read-tree', commit], env);
  git(repo, ['checkout-index', '--all', `--prefix=${root}${path.sep}`], env);
}

// History tests name commits of the repository `judge test` runs in. A ref is never replaced by another one.
function resolveCommit(field: string, ref: string): string {
  try {
    return git(repoRoot(), ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]).trim();
  } catch {
    throw new InvalidTest(`\`${field}: ${ref}\` does not name a commit of this repository; in a shallow clone, fetch it first`);
  }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function withoutGitLocation(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = { ...env };
  for (const name of GIT_LOCATION_VARIABLES) delete kept[name];
  return kept;
}

function firstLine(text: string): string {
  return String(text).trim().split('\n')[0];
}
