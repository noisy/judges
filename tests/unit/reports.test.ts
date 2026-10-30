import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pairReports, reportsUsageError, writeReports, ReportRun } from '../../src/reports/index.js';
import { parseArgs } from '../../src/config.js';

const run: ReportRun = {
  results: [{
    judgeId: 'r', displayName: 'r', file: '/repo/rules/r.md', status: 'ok', durationMs: 5,
    issues: [{ file: 'src/a.py', line: 2, severity: 'medium', message: 'msg' }]
  }],
  root: '/repo',
  version: '1.0.0'
};

describe('reportsUsageError', () => {
  it('accepts matching pairs of known formats, and no reports at all', () => {
    expect(reportsUsageError(['gitlab', 'sarif', 'junit'], ['a', 'b', 'c'])).toBeUndefined();
    expect(reportsUsageError([], [])).toBeUndefined();
  });

  it('rejects an unknown format and names the known ones', () => {
    expect(reportsUsageError(['checkstyle'], ['a'])).toBe("unknown --format 'checkstyle'; use one of: gitlab, sarif, junit");
  });

  it('rejects a different number of --format and --output flags', () => {
    expect(reportsUsageError(['gitlab', 'sarif'], ['a'])).toContain('every --format needs its own --output');
    expect(reportsUsageError([], ['a'])).toContain('every --format needs its own --output');
  });
});

describe('pairReports', () => {
  it('gives the n-th --output the n-th --format', () => {
    const config = parseArgs(['--format', 'gitlab', '--output', 'gl.json', '--format', 'junit', '--output', 'out/j.xml']);
    expect(pairReports(config.formats, config.outputs)).toEqual([
      { format: 'gitlab', output: 'gl.json' },
      { format: 'junit', output: 'out/j.xml' }
    ]);
  });
});

describe('writeReports', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('writes each report relative to the working directory, creating missing directories and replacing old files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judges-reports-'));
    fs.writeFileSync(path.join(dir, 'gl.json'), 'old');

    writeReports([{ format: 'gitlab', output: 'gl.json' }, { format: 'sarif', output: 'deep/er/judges.sarif' }], run, dir);

    const gitlab = JSON.parse(fs.readFileSync(path.join(dir, 'gl.json'), 'utf-8'));
    expect(gitlab[0]).toMatchObject({ check_name: 'r', severity: 'major', location: { path: 'src/a.py', lines: { begin: 2 } } });
    const sarif = JSON.parse(fs.readFileSync(path.join(dir, 'deep/er/judges.sarif'), 'utf-8'));
    expect(sarif.runs[0].results[0].level).toBe('warning');
  });
});
