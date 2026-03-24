#!/usr/bin/env node
import { parseArgs, AppConfig } from './config.js';
import { extractDiff } from './diff.js';
import { resolvePaths, readContents } from './files.js';
import { discoverJudges, Judge } from './judges.js';
import { ProgressRenderer, JudgeProgress } from './ui.js';
import { runJudgesParallel } from './runner.js';
import { formatIssuesList } from './format.js';
import colors from 'picocolors';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

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
  --version, -v Show the version number
  `);
}

function resolveInputContext(config: AppConfig): string {
  if (config.paths.length > 0) {
    const paths = resolvePaths(config.paths);
    return readContents(paths);
  }
  if (config.file) {
    const paths = resolvePaths(config.file);
    return readContents(paths);
  }
  
  if (config.staged) {
    return extractDiff('staged');
  } else if (config.diff) {
    return extractDiff('diff');
  } else if (config.lastCommit) {
    return extractDiff('last-commit');
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

  const results = await runJudgesParallel(progressList, inputContext, config.engine);

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

  if (config.version) {
    console.log(`judge-cli v${pkg.version}`);
    return;
  }

  if (config.help) {
    printHelp();
    return;
  }

  let inputContext = '';
  try {
    inputContext = resolveInputContext(config);
  } catch (error: any) {
    if (!config.json) {
      console.error(colors.red(`\n❌ Error: ${error.message}\n`));
    }
    process.exit(1);
    return;
  }
  
  const judges = discoverJudges();
  
  if (judges.length === 0) {
    console.log("No judges found in ~/.judge/judges/ or ./.judge/judges/");
    return;
  }

  const results = await orchestrateEvaluation(judges, inputContext, config);

  if (config.json) {
    console.log(JSON.stringify(results, null, 2));
  }

  let maxSeverityNumeric = 0;
  const severityMap: Record<string, number> = { low: 1, medium: 2, high: 3 };

  for (const progress of results) {
    if (progress.issues) {
      for (const issue of progress.issues) {
        if (issue.severity) {
          const score = severityMap[issue.severity.toLowerCase()] || 0;
          if (score > maxSeverityNumeric) {
            maxSeverityNumeric = score;
          }
        }
      }
    }
  }

  if (config.failOn) {
    const threshold = severityMap[config.failOn] || 0;
    if (threshold > 0 && maxSeverityNumeric >= threshold) {
      console.log(colors.red(`\n❌ Execution blocked: Issues of severity '${config.failOn}' or higher were found.`));
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
