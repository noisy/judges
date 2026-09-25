#!/usr/bin/env node
import { parseArgs, AppConfig } from './config.js';
import { extractDiff } from './diff.js';
import { resolvePaths, readContents } from './files.js';
import { discoverJudges, selectJudges, Judge } from './judges.js';
import { ProgressRenderer, issueSummaryLine } from './ui.js';
import { EvaluationContext, JudgeResult } from './types.js';
import { runPlan } from './runner.js';
import { buildPlan } from './plan.js';
import { auditMarkers } from './marker-audit.js';
import { formatIssuesList, formatJudgeFailure } from './format.js';
import { shouldBlock } from './gate.js';
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

  const { loaded, selected: judges } = loadJudgesOrExit(config);

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
      const fileName = path.basename(j.filePath);
      if (j.isValid) {
        console.log(colors.green(`✔ ${j.id} ${fileName} is valid (${describeSettings(j)})`));
      } else {
        hasErrors = true;
        console.log(colors.red(`✘ ${j.id} ${fileName} is invalid`));
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
        console.warn(colors.yellow(`⚠ skipping ${j.filePath} — invalid:\n  └─ ${j.validationErrors.join('\n  └─ ')}`));
      }
      return false;
    }
    return true;
  });

  if (validJudges.length === 0) {
    console.log("No valid judges found in ~/.judge/judges/, ./.judge/judges/ or --rules directories");
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
  
  const results = await orchestrateEvaluation(validJudges, inputContext, loaded.map(j => j.id), config);

  if (config.json) {
    console.log(JSON.stringify(results, null, 2));
  }

  if (shouldBlock(results, config.failOn)) {
    console.log(colors.red(`\n❌ Execution blocked: Issues of severity '${config.failOn}' or higher were found.`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Markers may name any loaded rule, so the full set is kept next to the --only selection.
function loadJudgesOrExit(config: AppConfig): { loaded: Judge[]; selected: Judge[] } {
  try {
    const loaded = discoverJudges(config.ruleDirs);
    const selected = config.command === 'config' ? loaded : selectJudges(loaded, config.only);
    return { loaded, selected };
  } catch (error: any) {
    console.error(colors.red(`❌ Error: ${error.message}`));
    process.exit(1);
  }
}

function describeSettings(judge: Judge): string {
  if (judge.format === 'rule') {
    return `${judge.severity} · ${judge.check} · ${judge.timeout_seconds}s`;
  }
  return `v${judge.version} · ${judge.mode} · ${judge.timeout_seconds}s`;
}

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

async function orchestrateEvaluation(
  judges: Judge[],
  inputContext: EvaluationContext,
  knownRuleIds: string[],
  config: AppConfig
): Promise<JudgeResult[]> {
  const renderer = new ProgressRenderer(judges);
  
  if (!config.json) {
    renderer.start();
  }

  const plan = buildPlan(judges, inputContext);
  const judgeResults = await runPlan(plan, config.engine, (event) => renderer.update(event));
  const markerAudit = auditMarkers(inputContext, knownRuleIds);
  const results = markerAudit.issues.length > 0 ? [...judgeResults, markerAudit] : judgeResults;

  if (!config.json) {
    renderer.stop();
    if (markerAudit.issues.length > 0) console.log(issueSummaryLine(markerAudit.displayName, markerAudit.issues));
    printHumanReadableResults(results, config);
  }

  return results;
}

function printHumanReadableResults(results: JudgeResult[], config: AppConfig): void {
  if (config.visibleIssueLimit > 0) {
    console.log('\n--- Evaluation Details ---\n');
    for (const result of results) {
      if (result.error) {
         console.log(formatJudgeFailure(result.displayName, result.error));
      } else if (result.issues.length > 0) {
         const issuesToShow = result.issues.slice(0, config.visibleIssueLimit);
         console.log(formatIssuesList(result.displayName, issuesToShow, result.issues.length));
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
  --rules <dir> Load flat rule files (<dir>/<id>.md); repeatable, overrides judges with the same id
  --only <id>  Run only the named judge or rule; repeatable
  --help, -h   Show this help message
  --version, -v Show the version number
  `);
}

