#!/usr/bin/env node
import { parseArgs, AppConfig } from './config.js';
import { extractDiff } from './diff.js';
import { readFiles } from './files.js';
import { discoverJudges, Judge } from './judges.js';
import { ProgressRenderer, JudgeProgress } from './ui.js';
import { runJudgesParallel } from './runner.js';
import { formatIssuesList } from './format.js';
import colors from 'picocolors';

function printHelp(): void {
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
}

function resolveInputContext(config: AppConfig): string {
  if (config.paths.length > 0) {
    return readFiles(config.paths);
  }
  if (config.file) {
    return readFiles(config.file);
  }
  
  if (config.staged) {
    return extractDiff('staged');
  } else if (config.diff) {
    return extractDiff('diff');
  }

  return extractDiff('head');
}

async function orchestrateEvaluation(judges: Judge[], inputContext: string, config: AppConfig): Promise<any[]> {
  const progressList: JudgeProgress[] = judges.map((judge) => ({ 
    judge, 
    state: 'pending', 
    displayName: judge.name || judge.id 
  }));

  const renderer = new ProgressRenderer(progressList);
  
  if (!config.json) {
    renderer.start();
  }

  const results = await runJudgesParallel(progressList, inputContext);

  if (!config.json) {
    renderer.stop();
    printHumanReadableResults(progressList, config);
  }

  return results;
}

function printHumanReadableResults(progressList: JudgeProgress[], config: AppConfig): void {
  if (config.visibleIssueLimit > 0) {
    console.log('\n--- Evaluation Details ---\n');
    for (const progress of progressList) {
      if (progress.issues && progress.issues.length > 0) {
         const issuesToShow = progress.issues.slice(0, config.visibleIssueLimit);
         console.log(formatIssuesList(progress.displayName, issuesToShow, progress.issues.length));
      }
    }
  }
  console.log(colors.bold("\n--- Done ---\n"));
}

async function main() {
  const argsArray = process.argv.slice(2);
  const config = parseArgs(argsArray);

  if (config.help) {
    printHelp();
    return;
  }

  const inputContext = resolveInputContext(config);
  const judges = discoverJudges();
  
  if (judges.length === 0) {
    console.log("No judges found in ~/.judge/judges/ or ./.judge/judges/");
    return;
  }

  const results = await orchestrateEvaluation(judges, inputContext, config);

  if (config.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
