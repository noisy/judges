import pc from 'picocolors';
import { Issue } from './llm.js';

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
