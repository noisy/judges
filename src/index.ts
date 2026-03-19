#!/usr/bin/env node
import mri from 'mri';
import logUpdate from 'log-update';
import pc from 'picocolors';

import { extractDiff } from './diff.js';
import { readFiles } from './files.js';
import { discoverJudges, Judge } from './judges.js';
import { constructPrompt } from './prompt.js';
import { executeLLM, Issue } from './llm.js';
import { formatIssuesList } from './format.js';

async function main() {
  const argv = process.argv.slice(2);
  const args = mri(argv, {
    string: ['file', 'top'],
    boolean: ['json', 'help', 'short', 'full'],
    alias: {
      f: 'file',
      j: 'json',
      h: 'help',
      s: 'short',
      t: 'top'
    }
  });

  if (args.help) {
    console.log(`
Usage: judge [options]

Options:
  --file, -f   Evaluate a specific file or files instead of git diff
  --json, -j   Output results in JSON format (for agents)
  --short, -s  Only show the summarization line per judge (0 issues detailed)
  --full       Show all issues found by judges
  --top <X>    Show the top X issues per judge (Default: 3)
  --help, -h   Show this help message
    `);
    process.exit(0);
  }

  let maxIssuesToShow = 3;
  if (args.short) {
    maxIssuesToShow = 0;
  } else if (args.full) {
    maxIssuesToShow = Infinity;
  } else if (args.top !== undefined) {
    maxIssuesToShow = parseInt(args.top, 10);
    if (isNaN(maxIssuesToShow)) maxIssuesToShow = 3;
  }

  let inputContext = '';

  if (args.file) {
    inputContext = readFiles(args.file);
  } else {
    inputContext = extractDiff();
  }

  const judges = discoverJudges();
  if (judges.length === 0) {
    console.log("No judges found in ~/.judge/judges/ or ./.judge/judges/");
    process.exit(0);
  }

  type JudgeState = 'pending' | 'running' | 'done' | 'error';
  interface JudgeProgress {
    judge: Judge;
    state: JudgeState;
    issues?: Issue[];
  }
  
  const progress: JudgeProgress[] = judges.map(j => ({ judge: j, state: 'pending' }));
  
  if (!args.json) {
    console.log(pc.bold("\n--- Starting Judges Evaluation ---\n"));
  }

  const renderUIDelay = 80; // ms
  let interval: ReturnType<typeof setInterval> | null = null;
  
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIdx = 0;

  function renderUI() {
    let output = '';
    for (const p of progress) {
      const name = p.judge.name || p.judge.id;
      if (p.state === 'pending') {
        output += `  ${pc.gray('○')} ${name}\n`;
      } else if (p.state === 'running') {
        output += `  ${pc.yellow(frames[frameIdx])} ${pc.cyan(name)} evaluating...\n`;
      } else if (p.state === 'done') {
         const issueCount = p.issues?.length || 0;
         if (issueCount === 0) {
            output += `  ${pc.green('✔')} ${name}: 0 issues\n`;
         } else {
            const highs = p.issues!.filter(i => i.severity === 'high').length;
            const meds = p.issues!.filter(i => i.severity === 'medium').length;
            const lows = p.issues!.filter(i => i.severity === 'low').length;
            const summary = [
               highs > 0 ? pc.red(`${highs} High`) : '',
               meds > 0 ? pc.yellow(`${meds} Med`) : '',
               lows > 0 ? pc.blue(`${lows} Low`) : ''
            ].filter(Boolean).join(', ');
            
            output += `  ${pc.red('✘')} ${pc.bold(name)}: ${issueCount} issues (${summary})\n`;
         }
      }
    }
    logUpdate(output);
  }

  if (!args.json) {
    interval = setInterval(() => {
      frameIdx = (frameIdx + 1) % frames.length;
      renderUI();
    }, renderUIDelay);
  }

  // Parallel Execution
  const promises = progress.map(async (p) => {
    p.state = 'running';
    const prompt = constructPrompt(p.judge, inputContext);
    const issues = await executeLLM(prompt);
    p.issues = issues;
    p.state = 'done';
    
    // Sort issues by severity: High -> Medium -> Low
    const sevScore = { 'high': 3, 'medium': 2, 'low': 1 };
    issues.sort((a, b) => (sevScore[b.severity] || 0) - (sevScore[a.severity] || 0));

    return { 
      judge: p.judge.name || p.judge.id, 
      file: p.judge.filePath, 
      issues 
    };
  });

  const results = await Promise.all(promises);

  if (interval) {
    clearInterval(interval);
    renderUI(); // Final frame
    logUpdate.done();
  }
  
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    // Print detailed issues based on mode
    if (maxIssuesToShow > 0) {
      console.log('\n--- Evaluation Details ---\n');
      for (const p of progress) {
        if (p.issues && p.issues.length > 0) {
           const issuesToShow = p.issues.slice(0, maxIssuesToShow);
           console.log(formatIssuesList(p.judge.name || p.judge.id, issuesToShow, p.issues.length));
        }
      }
    }
    console.log(pc.bold("\n--- Done ---\n"));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
