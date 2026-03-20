import logUpdate from 'log-update';
import colors from 'picocolors';
import { Judge } from './judges.js';
import { Issue } from './llm.js';

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
    this.interval = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % this.frames.length;
      this.render();
    }, this.uiRefreshIntervalMs);
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.render();
      logUpdate.done();

      const allIssues = this.progressList.flatMap(p => p.issues ?? []);
      const errors = allIssues.filter(i => i.severity === 'high').length;
      const warnings = allIssues.filter(i => i.severity === 'medium').length;
      const infos = allIssues.filter(i => i.severity === 'low').length;
      const total = allIssues.length;

      if (total === 0) {
        console.log(colors.green('✓ 0 problems'));
      } else {
        const parts: string[] = [];
        if (errors > 0) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
        if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? 's' : ''}`);
        if (infos > 0) parts.push(`${infos} info`);
        console.log(colors.red(`✗ ${total} problem${total !== 1 ? 's' : ''}`) + ` (${parts.join(', ')})`);
      }
    }
  }

  private render(): void {
    const segments: string[] = [];
    for (const p of this.progressList) {
      const name = p.displayName;
      if (p.state === 'pending') {
        segments.push(colors.dim(name));
      } else if (p.state === 'running') {
        segments.push(`${colors.yellow(this.frames[this.frameIdx])} ${colors.cyan(name)}`);
      } else if (p.state === 'done') {
        const count = p.issues?.length ?? 0;
        if (count === 0) {
          segments.push(`${colors.green('✓')} ${name}`);
        } else {
          segments.push(`${colors.red('✗')} ${name} ${colors.dim(`(${count})`)}`);
        }
      } else if (p.state === 'error') {
        segments.push(`${colors.red('!')} ${name}`);
      }
    }
    logUpdate(segments.join('  '));
  }
}
