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

// Agent judges stream events so every tool call can be recorded; one-shot judges need only the result.
const AGENT_OUTPUT_ARGS = ['--output-format', 'stream-json', '--verbose'];
const ONE_SHOT_OUTPUT_ARGS = ['--output-format', 'json'];

type CliEvent = Record<string, any>;

export function buildClaudeArgs(req: EngineRequest): string[] {
  const outputArgs = req.mode === 'agent' ? AGENT_OUTPUT_ARGS : ONE_SHOT_OUTPUT_ARGS;
  const args = ['-p', req.prompt, ...outputArgs, '--tools', req.tools.join(','), ...MINIMAL_CONFIG_ARGS, ...SANDBOX_ARGS];
  const model = resolveModel('claude', req.model);
  if (model) args.push('--model', model);
  if (req.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(req.maxBudgetUsd));
  if (req.maxTurns !== undefined) args.push('--max-turns', String(req.maxTurns));
  return args;
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

function relativeToRoot(target: string, cwd?: string): string {
  if (!cwd || !path.isAbsolute(target)) return target;
  const relative = path.relative(cwd, target);
  return relative.startsWith('..') ? target : relative || '.';
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
