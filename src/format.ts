import pc from 'picocolors';
import { Issue } from './llm.js';

export function formatIssuesList(judgeName: string, issues: Issue[], totalIssues: number): string {
  if (issues.length === 0) return '';

  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const file = issue.file || '(unknown)';
    if (!grouped.has(file)) grouped.set(file, []);
    grouped.get(file)!.push(issue);
  }

  let output = '';

  for (const [file, fileIssues] of grouped) {
    output += `${pc.underline(file)}\n`;
    for (const issue of fileIssues) {
      const line = issue.line ?? 0;
      const loc = pc.dim(`${line}:`);
      let severityLabel: string;
      switch (issue.severity?.toLowerCase()) {
        case 'high':
          severityLabel = pc.red('error');
          break;
        case 'medium':
          severityLabel = pc.yellow('warning');
          break;
        default:
          severityLabel = pc.dim('info');
          break;
      }
      const msg = issue.message.split('\n')[0];
      output += `  ${loc}  ${severityLabel}  ${msg}  ${pc.dim(judgeName)}\n`;
    }
    output += '\n';
  }

  if (totalIssues > issues.length) {
    const diff = totalIssues - issues.length;
    output += `  ${pc.dim(`... and ${diff} more issues. (Use --full or --top to see more)`)}\n\n`;
  }

  return output;
}
