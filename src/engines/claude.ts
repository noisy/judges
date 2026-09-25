import fs from 'fs';
import os from 'os';
import path from 'path';
import { EngineRequest } from './types.js';
import { createCliEngine, OutputInterpretation } from './process.js';
import { resolveModel } from './models.js';
import { ExaminedTarget } from '../types.js';

// Keeps the child from inheriting the developer's MCP servers, settings and sessions.
const MINIMAL_CONFIG_ARGS = ['--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];

// Read-only sandbox, verified on claude 2.1.282 with a canary file outside the repository:
// --restricted confines Read, Grep and Glob to the working directory (absolute paths, ../ and
// symlinks pointing out are all refused), whatever the settings allow;
// --permission-mode dontAsk with --permission-prompts none denies anything not pre-approved
// instead of waiting for an answer, so a print-mode run never hangs on a prompt;
// --disallowedTools keeps write, exec and network tools out even if --tools ever named one.
const SANDBOX_ARGS = [
  '--restricted',
  '--permission-mode', 'dontAsk',
  '--permission-prompts', 'none',
  '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch',
];

// Hard floor for secrets, denied on every run even inside the repo or an `allow_read` directory.
// `//` anchors a permission rule at the filesystem root, so `//**/x` matches x anywhere
// (a bare `**/x` would match only under the working directory). Deny rules also cover Grep and Glob.
export const SECRET_DENY_PATTERNS = ['**/.env*', '**/.ssh/**', '**/.aws/**', '**/.claude*/**', '**/*.pem', '**/*key*.json'];

// Agent judges stream events so every tool call can be recorded; one-shot judges need only the result.
const AGENT_OUTPUT_ARGS = ['--output-format', 'stream-json', '--verbose'];
const ONE_SHOT_OUTPUT_ARGS = ['--output-format', 'json'];

type CliEvent = Record<string, any>;

export function buildClaudeArgs(req: EngineRequest): string[] {
  const outputArgs = req.mode === 'agent' ? AGENT_OUTPUT_ARGS : ONE_SHOT_OUTPUT_ARGS;
  const args = [
    '-p', req.prompt, ...outputArgs, '--tools', req.tools.join(','), ...MINIMAL_CONFIG_ARGS, ...SANDBOX_ARGS,
    ...readAccessArgs(req.allowRead, req.cwd ?? process.cwd())
  ];
  const model = resolveModel('claude', req.model);
  if (model) args.push('--model', model);
  if (req.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(req.maxBudgetUsd));
  if (req.maxTurns !== undefined) args.push('--max-turns', String(req.maxTurns));
  return args;
}

// `allow_read` onto the sandbox: --restricted confines the file tools to the working directories,
// so each allowed directory joins them through --add-dir, which grants the whole directory
// (the validator accepts only whole directories for that reason). Matching allow rules state the
// same grant to the permission layer. Everything else outside the repo stays denied, and the
// secret deny rules win over both.
export function readAccessArgs(allowRead: string[], root: string, home: string = os.homedir()): string[] {
  const dirs = allowRead.map((pattern) => resolveAllowedDir(pattern, root, home));
  const permissions = {
    allow: dirs.map((dir) => `Read(/${dir}/**)`),
    deny: SECRET_DENY_PATTERNS.map((pattern) => `Read(//${pattern})`)
  };
  return [...dirs.flatMap((dir) => ['--add-dir', dir]), '--settings', JSON.stringify({ permissions })];
}

// "../billing-service/**" -> "/work/billing-service".
function resolveAllowedDir(pattern: string, root: string, home: string): string {
  const dir = pattern.replace(/\/\*\*$/, '');
  return realPath(dir.startsWith('~/') ? path.join(home, dir.slice(2)) : path.resolve(root, dir));
}

// The CLI compares real paths (/tmp is /private/tmp on macOS), so symlinks are resolved where they exist.
function realPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

// One-shot judges read nothing from disk, so a neutral directory keeps repo CLAUDE.md files out.
// Agent judges explore the repository, so they run in its root.
export function claudeWorkingDir(req: EngineRequest): string | undefined {
  return req.mode === 'agent' ? req.cwd : os.tmpdir();
}

export function interpretClaudeOutput(stdout: string, req: EngineRequest): OutputInterpretation {
  const events = parseEvents(stdout);
  const envelope = findResult(events);
  if (!envelope) {
    return { rawOutput: stdout };
  }
  const failure = describeFailure(envelope, req);
  if (failure) {
    throw new Error(`claude CLI stopped: ${failure}`);
  }
  const interpretation: OutputInterpretation = {
    rawOutput: typeof envelope.result === 'string' ? envelope.result : '',
    costUsd: asNumber(envelope.total_cost_usd),
    turns: asNumber(envelope.num_turns)
  };
  if (req.mode === 'agent') interpretation.examined = examinedTargets(events, envelope, req.cwd);
  return interpretation;
}

export function explainClaudeFailure(stdout: string, req: EngineRequest): string | undefined {
  const envelope = findResult(parseEvents(stdout));
  return envelope && describeFailure(envelope, req);
}

function describeFailure(envelope: CliEvent, req: EngineRequest): string | undefined {
  if (envelope.subtype === 'error_max_budget_usd') return `budget exceeded ($${req.maxBudgetUsd})`;
  if (envelope.subtype === 'error_max_turns') return `turn limit reached (${req.maxTurns})`;
  if (!envelope.is_error) return undefined;
  const errors = Array.isArray(envelope.errors) ? envelope.errors.join('; ') : '';
  return errors || String(envelope.result ?? envelope.subtype);
}

// `json` output is one object; `stream-json` is one object per line.
function parseEvents(stdout: string): CliEvent[] {
  const whole = parseObject(stdout);
  if (whole) return [whole];
  return stdout.split('\n').map(parseObject).filter((event): event is CliEvent => event !== undefined);
}

function parseObject(text: string): CliEvent | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findResult(events: CliEvent[]): CliEvent | undefined {
  return [...events].reverse().find((event) => event.type === 'result');
}

function examinedTargets(events: CliEvent[], envelope: CliEvent, cwd?: string): ExaminedTarget[] {
  const deniedIds = new Set((envelope.permission_denials ?? []).map((denial: CliEvent) => denial.tool_use_id));
  return events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block: CliEvent) => block.type === 'tool_use')
    .map((block: CliEvent) => {
      const target: ExaminedTarget = { tool: block.name, target: describeTarget(block.input ?? {}, cwd) };
      if (deniedIds.has(block.id)) target.denied = true;
      return target;
    });
}

// Read and LS name a path; Grep and Glob a pattern, optionally within a path.
function describeTarget(input: CliEvent, cwd?: string): string {
  const where = input.file_path ?? input.path;
  const shownPath = typeof where === 'string' ? relativeToRoot(where, cwd) : undefined;
  if (typeof input.pattern === 'string') {
    return shownPath ? `${input.pattern} in ${shownPath}` : input.pattern;
  }
  return shownPath ?? JSON.stringify(input);
}

// Inside the repo relative to its root; outside it the full path, so a use of `allow_read` shows.
function relativeToRoot(target: string, cwd?: string): string {
  if (!cwd) return target;
  const absolute = realPath(path.resolve(cwd, target));
  const relative = path.relative(realPath(cwd), absolute);
  return relative.startsWith('..') ? absolute : relative || '.';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export const claudeEngine = createCliEngine({
  name: 'claude',
  buildArgs: buildClaudeArgs,
  workingDir: claudeWorkingDir,
  supportsAgentMode: true,
  interpretOutput: interpretClaudeOutput,
  explainFailure: explainClaudeFailure
});
