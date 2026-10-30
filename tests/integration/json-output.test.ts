import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '../..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
const STOPPED_EXIT_CODE = 3;

// A stand-in `claude` on PATH: the rule whose prompt names STOPS hits its cost cap, the one naming BLOCKS reports
// a high finding.
const FAKE_CLAUDE = `#!/bin/sh
case "$*" in
  *CANARY_STOPS*) printf '%s\\n' '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":0.05,"num_turns":1}' ;;
  *CANARY_BLOCKS*) printf '%s\\n' '{"type":"result","is_error":false,"result":"[{\\"file\\":\\"a.py\\",\\"line\\":1,\\"severity\\":\\"high\\",\\"message\\":\\"print\\"}]"}' ;;
  *) printf '%s\\n' '{"type":"result","is_error":false,"result":"[]"}' ;;
esac
`;

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-json-'));
  const write = (file: string, content: string, mode?: number) => {
    fs.mkdirSync(path.dirname(path.join(workDir, file)), { recursive: true });
    fs.writeFileSync(path.join(workDir, file), content, { mode });
  };
  write('bin/claude', FAKE_CLAUDE, 0o755);
  write('a.py', 'print("hi")\n');
  write('rules/stops.md', '---\nid: stops\nbudget: "$0.05"\n---\nReport anything. CANARY_STOPS\n');
  write('rules/blocks.md', '---\nid: blocks\nseverity: high\n---\nReport print calls. CANARY_BLOCKS\n');
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

// Runs the CLI from source in the work dir, with HOME there too, so no global judges are loaded.
function judge(...args: string[]) {
  const env = { ...process.env, HOME: workDir, PATH: `${path.join(workDir, 'bin')}${path.delimiter}${process.env.PATH}` };
  return spawnSync(TSX, [path.join(REPO, 'src', 'index.ts'), '--rules', 'rules', '--root', '.', '-f', 'a.py', '--json', ...args],
    { cwd: workDir, env, encoding: 'utf-8' });
}

describe('--json output', () => {
  it('keeps stdout pure JSON when a rule stopped and the run exits 3', () => {
    const run = judge('--only', 'stops');

    expect(run.status).toBe(STOPPED_EXIT_CODE);
    const [rule, totals] = JSON.parse(run.stdout);
    expect(rule.status).toBe('stopped');
    expect(totals.run.costUsd).toBe(0.05);
    expect(run.stderr).toContain('Rules stopped on a limit');
  });

  it('keeps stdout pure JSON when the run blocks', () => {
    const run = judge('--fail-on', 'high');

    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toHaveLength(3); // two rules and the run totals
    expect(run.stderr).toContain('Execution blocked');
  });
});
