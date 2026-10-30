#!/usr/bin/env node
import { parseArgs, inputUsageError, onStopUsageError, stageUsageError, AppConfig, OnStop, UsageError, USAGE_ERROR_EXIT_CODE } from './config.js';
import { extractDiff } from './diff.js';
import { resolvePaths, readContents, repoRoot } from './files.js';
import { discoverJudges, selectJudges, ruleFileName, Judge } from './judges.js';
import { ProgressRenderer, issueSummaryLine } from './ui.js';
import { EvaluationContext, JudgeResult, Stage } from './types.js';
import { runPlan } from './runner.js';
import { buildPlan } from './plan.js';
import { auditMarkers } from './marker-audit.js';
import { findMarkersInFiles } from './markers.js';
import { groupByRule, formatInventory } from './inventory.js';
import { formatCostLine, formatIssuesList, formatJudgeFailure } from './format.js';
import { calledModel, runTotals } from './run-totals.js';
import { GateOutcome, gateOutcome, stoppedRules } from './gate.js';
import { pairReports, reportsUsageError, writeReports } from './reports/index.js';
import { withoutRuleTests } from './rule-test-spec.js';
import { testRules, testExitCode, formatTestResults } from './rule-test.js';
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

  const reportsError = config.command === undefined ? reportsUsageError(config.formats, config.outputs) : undefined;
  const usageError = inputUsageError(config) ?? stageUsageError(config) ?? onStopUsageError(config) ?? reportsError;
  if (usageError) {
    console.error(colors.red(`❌ Error: ${usageError}`));
    process.exit(USAGE_ERROR_EXIT_CODE);
  }

  if (config.command === 'markers') {
    printMarkerInventory(config);
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
      const fileName = ruleFileName(j);
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

  if (config.command === 'test') {
    await runRuleTests(judges, config);
    return;
  }

  if (judges.length === 0) {
    statusPrinter(config)("No judges found in ~/.judge/judges/, ./.judge/judges/ or --rules directories");
    return;
  }

  let inputContext: EvaluationContext;
  try {
    inputContext = withoutRuleTests(resolveInputContext(config), config.ruleDirs);
  } catch (error: any) {
    // A usage error is reported even with --json: there is no report to carry it.
    if (error instanceof UsageError) {
      console.error(colors.red(`❌ Error: ${error.message}`));
      process.exit(USAGE_ERROR_EXIT_CODE);
    }
    if (!config.json) {
      console.error(colors.red(`\n❌ Error: ${error.message}\n`));
    }
    process.exit(1);
    return;
  }
  
  const results = await orchestrateEvaluation(judges, inputContext, loaded.map(j => j.id), config);

  if (config.json) {
    // The totals are one more entry, not a new top-level object, so scripts that read the array keep working.
    console.log(JSON.stringify([...results, { run: runTotals(results) }], null, 2));
  }

  // Before the gate can exit, so a blocked pipeline still has its reports.
  const root = inputContext.root ?? repoRoot();
  writeReports(pairReports(config.formats, config.outputs), { results, root, version: pkg.version });

  const outcome = gateOutcome(results, config.failOn, config.onStop as OnStop);
  printGateOutcome(outcome, results, config);
  if (outcome !== 'passed') process.exit(GATE_EXIT_CODES[outcome]);
}

// 3 is simply the next free exit code: CI can treat it as a warning (GitLab `allow_failure: exit_codes: [3]`).
const GATE_EXIT_CODES: Record<GateOutcome, number> = { passed: 0, 'blocked-by-findings': 1, 'blocked-by-stop': 1, stopped: 3 };

function printGateOutcome(outcome: GateOutcome, results: JudgeResult[], config: AppConfig): void {
  const print = statusPrinter(config);
  const stopped = stoppedRules(results).map((result) => result.judgeId).join(', ');
  if (outcome === 'blocked-by-findings') {
    print(colors.red(`\n❌ Execution blocked: Issues of severity '${config.failOn}' or higher were found.`));
  } else if (outcome === 'blocked-by-stop') {
    print(colors.red(`\n❌ Execution blocked: rules stopped on a limit and did not finish (--on-stop fail): ${stopped}`));
  } else if (outcome === 'stopped') {
    print(colors.yellow(`\n⚠ Rules stopped on a limit and did not finish: ${stopped}. Exit code 3 (--on-stop warn).`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// With --json, stdout holds only the JSON report, so `judge --json | jq` works: status lines go to stderr.
// The human report keeps them on stdout, after the results they sum up.
function statusPrinter(config: AppConfig): (line: string) => void {
  return config.json ? console.error : console.log;
}

// Markers may name any loaded rule, so the full set is kept next to the --only selection.
function loadJudgesOrExit(config: AppConfig): { loaded: Judge[]; selected: Judge[] } {
  try {
    const loaded = discoverJudges(config.ruleDirs);
    const selected = config.command === 'config' ? loaded : selectJudges(loaded, config.only);
    return { loaded, selected };
  } catch (error: any) {
    console.error(colors.red(`❌ Error: ${error.message}`));
    process.exit(error instanceof UsageError || config.command === 'test' ? USAGE_ERROR_EXIT_CODE : 1);
  }
}

// Runs each rule on its tests; the exit code says whether every test passed.
// An invalid rule is not left out: each of its tests fails with did-not-run, as in a review it reports an error.
async function runRuleTests(judges: Judge[], config: AppConfig): Promise<void> {
  const entries = await testRules(judges, config.engine);
  if (entries.length === 0) {
    console.error(colors.red('❌ Error: no rules to test; pass a rules directory with --rules <dir>'));
    process.exit(USAGE_ERROR_EXIT_CODE);
  }
  console.log(config.json ? JSON.stringify(entries, null, 2) : formatTestResults(entries));
  // Not process.exit: it can cut off a long report still being written to a pipe.
  process.exitCode = testExitCode(entries);
}

// Lists markers in the given paths, or in the whole repository by default.
function printMarkerInventory(config: AppConfig): void {
  try {
    const paths = config.paths.length > 0 ? config.paths : [repoRoot()];
    const groups = groupByRule(findMarkersInFiles(readContents(resolvePaths(paths)).files));
    console.log(config.json ? JSON.stringify(groups, null, 2) : formatInventory(groups));
  } catch (error: any) {
    console.error(colors.red(`❌ Error: ${error.message}`));
    process.exit(1);
  }
}

function describeSettings(judge: Judge): string {
  if (judge.format === 'rule') {
    return `${judge.severity} · ${judge.mode} · ${judge.timeout_seconds}s`;
  }
  return `v${judge.version} · ${judge.mode} · ${judge.timeout_seconds}s`;
}

// The root is where agent judges explore and what file paths are shown relative to.
function resolveInputContext(config: AppConfig): EvaluationContext {
  const root = config.root ? path.resolve(config.root) : repoRoot();
  return { ...readInput(config, root), root };
}

function readInput(config: AppConfig, root: string): EvaluationContext {
  if (config.paths.length > 0) {
    const paths = resolvePaths(config.paths);
    return readContents(paths, root);
  }
  if (config.file) {
    const paths = resolvePaths(config.file);
    return readContents(paths, root);
  }
  
  if (config.staged) {
    return extractDiff('staged');
  } else if (config.diff) {
    return extractDiff('diff');
  } else if (config.lastCommit) {
    return extractDiff('last-commit');
  } else if (config.base !== undefined) {
    return extractDiff('base', config.base);
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

  const plan = buildPlan(judges, inputContext, config.stage as Stage | undefined); // checked by stageUsageError
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
  if (results.some(calledModel)) console.log(`\n${formatCostLine(runTotals(results))}`);
  console.log(colors.bold("\n--- Done ---\n"));
}

function printHelp(): void {
  console.log(`
Usage: judge [options] [paths...]
       judge markers [paths...] [--json]   List rule-exception / rule-debt markers, grouped by rule
       judge test [--rules <dir>] [--only <id>] [--json]   Run each rule on its tests (<dir>/<id>/tests/)

Options:
  --file, -f   Evaluate a specific file or files instead of git diff
  --json, -j   Output results in JSON format (for agents)
  --short, -s  Only show the summarization line per judge (0 issues detailed)
  --full       Show all issues found by judges
  --top <X>    Show the top X issues per judge (Default: 3)
  --rules <dir> Load rules (<dir>/<id>.md and <dir>/<id>/RULE.md); repeatable, overrides judges with the same id
  --only <id>  Run only the named judge or rule; repeatable
  --stage <name> Run only the rules of a gate: commit, push or ci (ci runs all; default: all)
  --root <dir> Repository root agent judges explore (default: the git root); file input only
  --base <ref> Review the branch's commits since it left <ref> (git diff <ref>...HEAD)
  --fail-on <low|medium|high>
               Exit 1 when a finding is at or above this severity
  --on-stop <warn|fail|ignore>
               What a rule stopped by its time, turn or cost limit does: warn exits 3 when nothing
               blocked (default), fail exits 1, ignore keeps the exit code
  --format <gitlab|sarif|junit> --output <path>
               Also write the findings as a CI report; repeatable, the n-th --output gets the n-th --format
  --help, -h   Show this help message
  --version, -v Show the version number

Exit codes: 0 passed, 1 blocked, 2 usage error, 3 a rule stopped on a limit and nothing blocked
  `);
}

