import * as fs from 'fs';
import path from 'path';
import { JudgeResult } from '../types.js';
import { collectFindings, ruleIds } from './findings.js';
import { gitlabReport } from './gitlab.js';
import { sarifReport } from './sarif.js';
import { junitReport } from './junit.js';

export const REPORT_FORMATS = ['gitlab', 'sarif', 'junit'];

export interface ReportRequest {
  format: string;
  output: string;
}

export interface ReportRun {
  results: JudgeResult[];
  root: string; // report paths are relative to it
  version: string;
}

export function reportsUsageError(formats: string[], outputs: string[]): string | undefined {
  const unknown = formats.find((format) => !REPORT_FORMATS.includes(format));
  if (unknown !== undefined) {
    return `unknown --format '${unknown}'; use one of: ${REPORT_FORMATS.join(', ')}`;
  }
  if (formats.length !== outputs.length) {
    return `every --format needs its own --output (got ${formats.length} --format and ${outputs.length} --output)`;
  }
  return undefined;
}

// The n-th --output gets the n-th --format.
export function pairReports(formats: string[], outputs: string[]): ReportRequest[] {
  return formats.map((format, index) => ({ format, output: outputs[index] }));
}

// Outputs are relative to the working directory, like any other path a user types.
export function writeReports(reports: ReportRequest[], run: ReportRun, cwd: string = process.cwd()): void {
  for (const report of reports) {
    const target = path.resolve(cwd, report.output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderReport(report.format, run));
  }
}

export function renderReport(format: string, run: ReportRun): string {
  const findings = collectFindings(run.results, run.root);
  switch (format) {
    case 'gitlab':
      return gitlabReport(findings);
    case 'sarif':
      return sarifReport(findings, ruleIds(run.results), run.version);
    case 'junit':
      return junitReport(run.results, findings);
    default:
      throw new Error(`unknown report format '${format}'`);
  }
}
