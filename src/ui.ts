import logUpdate from 'log-update';
import colors from 'picocolors';
import { Judge, displayName } from './judges.js';
import { Issue, JudgeEvent, JudgeStatus } from './types.js';

export type JudgeState = 'pending' | 'running' | 'done';

interface JudgeProgress {
  displayName: string;
  judge: Judge;
  state: JudgeState;
  issues?: Issue[];
  suppressed?: number;
  status?: JudgeStatus;
  error?: string;
  skipReason?: string;
}

export class ProgressRenderer {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIdx = 0;
  private readonly uiRefreshIntervalMs = 80;

  private readonly progressList: JudgeProgress[];

  constructor(judges: Judge[]) {
    this.progressList = judges.map((judge) => ({ judge, state: 'pending', displayName: displayName(judge) }));
  }

  public update(event: JudgeEvent): void {
    const p = this.progressList.find((progress) => progress.judge.id === event.judgeId);
    if (!p) return;

    p.state = event.state;
    if (event.state === 'done') {
      p.status = event.result.status;
      p.issues = event.result.issues;
      p.suppressed = event.result.suppressed;
      p.error = event.result.error;
      p.skipReason = event.result.skipReason;
    }
  }

  public start(): void {
    console.log(colors.bold("\n--- Starting Judges Evaluation ---\n"));
    this.interval = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % this.frames.length;
      this.render();
    }, this.uiRefreshIntervalMs);
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.render(); // final frame
      logUpdate.done();
    }
  }

  private render(): void {
    let output = '';
    for (const p of this.progressList) {
      if (p.state === 'pending') {
        output += `  ${colors.gray('○')} ${p.displayName}\n`;
      } else if (p.state === 'running') {
        output += `  ${colors.yellow(this.frames[this.frameIdx])} ${colors.cyan(p.displayName)} evaluating...\n`;
      } else if (p.state === 'done' && p.status === 'skipped') {
         output += `  ${colors.dim(`○ ${p.displayName}: skipped (${p.skipReason})`)}\n`;
      } else if (p.state === 'done' && p.status === 'timeout') {
         output += `  ${colors.yellow('⚠')} ${colors.bold(p.displayName)}: timed out after ${p.judge.timeout_seconds}s\n`;
      } else if (p.state === 'done' && p.status === 'error') {
         output += `  ${colors.yellow('⚠')} ${colors.bold(p.displayName)}: error — ${firstLine(p.error)}\n`;
      } else if (p.state === 'done') {
         output += `${issueSummaryLine(p.displayName, p.issues || [], p.suppressed)}\n`;
      }
    }
    logUpdate(output);
  }
}

export function issueSummaryLine(name: string, issues: Issue[], suppressed = 0): string {
  const suppressedNote = suppressed > 0 ? `${suppressed} suppressed by markers` : '';
  if (issues.length === 0) {
    const note = suppressedNote ? ` (${suppressedNote})` : '';
    return `  ${colors.green('✔')} ${name}: 0 issues${note}`;
  }
  const details = [severityCounts(issues), suppressedNote].filter(Boolean).join('; ');
  return `  ${colors.red('✘')} ${colors.bold(name)}: ${issues.length} issues (${details})`;
}

function severityCounts(issues: Issue[]): string {
  const highs = issues.filter(i => i.severity === 'high').length;
  const meds = issues.filter(i => i.severity === 'medium').length;
  const lows = issues.filter(i => i.severity === 'low').length;
  return [
    highs > 0 ? colors.red(`${highs} High`) : '',
    meds > 0 ? colors.yellow(`${meds} Med`) : '',
    lows > 0 ? colors.blue(`${lows} Low`) : ''
  ].filter(Boolean).join(', ');
}

function firstLine(text: string = ''): string {
  return text.split('\n')[0];
}
