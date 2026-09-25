import os from 'os';
import { EngineRequest } from './types.js';
import { createCliEngine, OutputInterpretation } from './process.js';
import { resolveModel } from './models.js';

// Keeps the child from inheriting the developer's MCP servers, settings and sessions.
const MINIMAL_CONFIG_ARGS = ['--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];

type ResultEnvelope = Record<string, unknown>;

export function buildClaudeArgs(req: EngineRequest): string[] {
  const args = ['-p', req.prompt, '--output-format', 'json', '--tools', req.tools.join(','), ...MINIMAL_CONFIG_ARGS];
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
  const envelope = parseResultEnvelope(stdout);
  if (!envelope) {
    return { rawOutput: stdout };
  }
  const failure = describeFailure(envelope, req);
  if (failure) {
    throw new Error(`claude CLI stopped: ${failure}`);
  }
  return {
    rawOutput: typeof envelope.result === 'string' ? envelope.result : '',
    costUsd: asNumber(envelope.total_cost_usd),
    turns: asNumber(envelope.num_turns)
  };
}

export function explainClaudeFailure(stdout: string, req: EngineRequest): string | undefined {
  const envelope = parseResultEnvelope(stdout);
  return envelope && describeFailure(envelope, req);
}

function describeFailure(envelope: ResultEnvelope, req: EngineRequest): string | undefined {
  if (envelope.subtype === 'error_max_budget_usd') return `budget exceeded ($${req.maxBudgetUsd})`;
  if (envelope.subtype === 'error_max_turns') return `turn limit reached (${req.maxTurns})`;
  if (!envelope.is_error) return undefined;
  const errors = Array.isArray(envelope.errors) ? envelope.errors.join('; ') : '';
  return errors || String(envelope.result ?? envelope.subtype);
}

function parseResultEnvelope(stdout: string): ResultEnvelope | undefined {
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.type === 'result' ? parsed : undefined;
  } catch {
    return undefined;
  }
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
