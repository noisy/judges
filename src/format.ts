import pc from 'picocolors';
import { Issue, TokenUsage } from './types.js';
import { RunTotals } from './run-totals.js';

export function formatIssuesList(judgeName: string, issues: Issue[], totalIssues: number): string {
  if (issues.length === 0) return '';

  let output = `${pc.bold(pc.red('✘'))} ${pc.bold(judgeName)} Issues:\n\n`;

  for (const issue of issues) {
    let severityTag = '';
    switch (issue.severity?.toLowerCase()) {
      case 'high':
        severityTag = pc.bgRed(pc.white(pc.bold(' HIGH ')));
        break;
      case 'medium':
        severityTag = pc.bgYellow(pc.black(pc.bold(' MED  ')));
        break;
      case 'low':
        severityTag = pc.bgBlue(pc.white(pc.bold(' LOW  ')));
        break;
      default:
        severityTag = pc.gray(pc.white(pc.bold(' INFO ')));
        break;
    }

    const fileLine = pc.cyan(`${issue.file}:${issue.line}`);
    output += `  ${severityTag} ${fileLine}\n`;
    
    // Use an indent for the message to look neat
    const indentedMessage = issue.message.split('\n').map(l => `      ${l}`).join('\n');
    output += `${indentedMessage}\n\n`;
  }

  if (totalIssues > issues.length) {
     const diff = totalIssues - issues.length;
     output += `  ... and ${diff} more issues. (Use --full or --top to see more)\n\n`;
  }

  return output;
}

export function formatJudgeFailure(judgeName: string, error: string): string {
  const indentedError = error.split('\n').map(l => `      ${l}`).join('\n');
  return `${pc.bold(pc.yellow('⚠'))} ${pc.bold(judgeName)} did not run:\n\n${indentedError}\n`;
}

const SUBSCRIPTION_NOTE = 'On a Claude subscription the real cost is lower.';
const THOUSAND = 1_000;
const MILLION = 1_000_000;
const PERCENT = 100;

// "Cost: $0.0246 at API prices (4.1k tokens, 40% cache reads). On a Claude subscription the real cost is lower."
export function formatCostLine(run: RunTotals): string {
  const approximately = run.costEstimated || run.tokensEstimated ? '≈ ' : '';
  const amount = run.costUsd === null ? 'unknown' : `${approximately}$${formatUsd(run.costUsd)}`;
  return `Cost: ${amount} at API prices (${tokenSummary(run.tokens)}). ${SUBSCRIPTION_NOTE}`;
}

// 4 decimals under $1, where a rule's cost lives; 2 from $1 on.
function formatUsd(amount: number): string {
  return amount < 1 ? amount.toFixed(4) : amount.toFixed(2);
}

// All four parts together, and how much of the input the cache served.
function tokenSummary(tokens: TokenUsage): string {
  const { input, cacheCreation, cacheRead, output } = tokens;
  if (input === null || cacheCreation === null || cacheRead === null || output === null) return 'tokens unknown';
  const allInput = input + cacheCreation + cacheRead;
  const cacheShare = allInput === 0 ? 0 : Math.round((cacheRead / allInput) * PERCENT);
  return `${compactCount(allInput + output)} tokens, ${cacheShare}% cache reads`;
}

// 950, 4.1k, 1.2M.
function compactCount(count: number): string {
  if (count < THOUSAND) return String(count);
  if (count < MILLION) return `${(count / THOUSAND).toFixed(1)}k`;
  return `${(count / MILLION).toFixed(1)}M`;
}
