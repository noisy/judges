import logUpdate from 'log-update';
import colors from 'picocolors';
import { Judge } from './judges.js';
import { Issue } from './types.js';

export type JudgeState = 'pending' | 'running' | 'done' | 'error';

export interface JudgeProgress {
  displayName: string;
  judge: Judge;
  state: JudgeState;
  issues?: Issue[];
}

export class ProgressRenderer {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIdx = 0;
  private readonly uiRefreshIntervalMs = 80;

  constructor(private readonly progressList: JudgeProgress[]) {}

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
      } else if (p.state === 'done') {
         const issueCount = p.issues?.length || 0;
         if (issueCount === 0) {
            output += `  ${colors.green('✔')} ${p.displayName}: 0 issues\n`;
         } else {
            const highs = p.issues!.filter(i => i.severity === 'high').length;
            const meds = p.issues!.filter(i => i.severity === 'medium').length;
            const lows = p.issues!.filter(i => i.severity === 'low').length;
            const summaryParts = [
               highs > 0 ? colors.red(`${highs} High`) : '',
               meds > 0 ? colors.yellow(`${meds} Med`) : '',
               lows > 0 ? colors.blue(`${lows} Low`) : ''
            ].filter(Boolean);
            const summary = summaryParts.join(', ');
            
            output += `  ${colors.red('✘')} ${colors.bold(p.displayName)}: ${issueCount} issues (${summary})\n`;
         }
      }
    }
    logUpdate(output);
  }
}
