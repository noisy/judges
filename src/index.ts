#!/usr/bin/env node
import { parseArgs, AppConfig } from './config.js';
import { extractDiff } from './diff.js';
import { resolvePaths, readContents } from './files.js';
import { discoverJudges, Judge } from './judges.js';
import { ProgressRenderer, JudgeProgress } from './ui.js';
import { EvaluationContext } from './types.js';
import { runJudgesParallel } from './runner.js';
import { formatIssuesList } from './format.js';
import colors from 'picocolors';
import { createRequire } from 'module';

import path from 'path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

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

  const judges = discoverJudges();

  if (config.command === 'config') {
    if (config.configAction === 'check') {
      const judgesToCheck = config.configTarget 
          ? judges.filter(j => j.id === config.configTarget) 
          : judges;

      if (judgesToCheck.length === 0 && config.configTarget) {
        console.error(colors.red(`❌ Judge '${config.configTarget}' not found.`));
        process.exit(1);
      }

      let hasErrors = false;
    for (const j of judgesToCheck) {
      if (j.isValid) {
        console.log(colors.green(`✔ ${j.id} JUDGE.md is valid (v${j.version} · ${j.mode} · ${j.timeout_seconds}s)`));
      } else {
        hasErrors = true;
        console.log(colors.red(`✘ ${j.id} JUDGE.md is invalid`));
        for (const err of j.validationErrors) {
           console.log(colors.red(`  └─ ${err}`));
        }
      }
    }
      process.exit(hasErrors ? 1 : 0);
      return;
    }
    
    // User cancelled the other flags like --list, so safely exit here for now.
    return;
  }

  const validJudges = judges.filter(j => {
    if (!j.isValid) {
      if (!config.json) {
        const dir = path.dirname(j.filePath);
        console.warn(colors.yellow(`⚠ skipping ${dir} — invalid JUDGE.md:\n  └─ ${j.validationErrors.join('\n  └─ ')}`));
      }
      return false;
    }
    return true;
  });

  if (validJudges.length === 0) {
    console.log("No valid judges found in ~/.judge/judges/ or ./.judge/judges/");
    return;
  }

  let inputContext: EvaluationContext;
  try {
    inputContext = resolveInputContext(config);
  } catch (error: any) {
    if (!config.json) {
      console.error(colors.red(`\n❌ Error: ${error.message}\n`));
    }
    process.exit(1);
    return;
  }
  
  const results = await orchestrateEvaluation(validJudges, inputContext, config);

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

function resolveInputContext(config: AppConfig): EvaluationContext {
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

async function orchestrateEvaluation(judges: Judge[], inputContext: EvaluationContext, config: AppConfig): Promise<any[]> {
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

