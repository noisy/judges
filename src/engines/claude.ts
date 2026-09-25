import { EngineRequest } from './types.js';
import { createCliEngine, OutputInterpretation } from './process.js';
import { resolveModel } from './models.js';

// Keeps the child from inheriting the developer's MCP servers, settings and sessions.
const MINIMAL_CONFIG_ARGS = ['--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];

export function buildClaudeArgs(req: EngineRequest): string[] {
  const args = ['-p', req.prompt, '--output-format', 'json', '--tools', req.tools.join(','), ...MINIMAL_CONFIG_ARGS];
  const model = resolveModel('claude', req.model);
  if (model) args.push('--model', model);
  if (req.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(req.maxBudgetUsd));
  if (req.maxTurns !== undefined) args.push('--max-turns', String(req.maxTurns));
  return args;
}

export function interpretClaudeOutput(stdout: string): OutputInterpretation {
  const envelope = parseJsonEnvelope(stdout);
  if (typeof envelope?.result !== 'string') {
    return { rawOutput: stdout };
  }
  if (envelope.is_error) {
    throw new Error(`claude CLI reported an error: ${envelope.result}`);
  }
  return {
    rawOutput: envelope.result,
    costUsd: asNumber(envelope.total_cost_usd),
    turns: asNumber(envelope.num_turns)
  };
}

function parseJsonEnvelope(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
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
  interpretOutput: interpretClaudeOutput
});
