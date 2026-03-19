import pc from 'picocolors';
import { Issue } from './llm.js';

export function formatTerminalOutput(judgeName: string, issues: Issue[]): string {
  if (issues.length === 0) {
    return `${pc.bold(pc.green('✔'))} ${pc.bold(judgeName)}: No issues found. Looks great!\n`;
  }

  let output = `${pc.bold(pc.red('✘'))} ${pc.bold(judgeName)} found ${issues.length} issue(s):\n\n`;

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

  return output;
}
