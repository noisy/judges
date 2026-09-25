import os from 'os';
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, claudeWorkingDir, explainClaudeFailure, interpretClaudeOutput } from '../../src/engines/claude.js';
import { buildCodexArgs, codexEngine } from '../../src/engines/codex.js';
import { buildGeminiArgs, geminiEngine } from '../../src/engines/gemini.js';
import { resolveModel } from '../../src/engines/models.js';
import { EngineRequest } from '../../src/engines/types.js';

const baseRequest: EngineRequest = { prompt: 'review this', mode: 'one-shot', timeoutMs: 30000, tools: [] };
const agentRequest: EngineRequest = { ...baseRequest, mode: 'agent', tools: ['Read', 'Grep', 'Glob'], cwd: '/repo' };

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('resolveModel', () => {
  it('maps size aliases to claude model aliases', () => {
    expect(resolveModel('claude', 'small')).toBe('haiku');
    expect(resolveModel('claude', 'medium')).toBe('sonnet');
    expect(resolveModel('claude', 'large')).toBe('opus');
  });

  it('passes any other string through as an exact model id', () => {
    expect(resolveModel('claude', 'claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(resolveModel('gemini', 'gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('falls back to the engine default for unmapped aliases and missing models', () => {
    expect(resolveModel('codex', 'small')).toBeUndefined();
    expect(resolveModel('claude', undefined)).toBeUndefined();
  });
});

describe('buildClaudeArgs', () => {
  it('builds a one-shot text judge with minimal config and no tools', () => {
    const args = buildClaudeArgs(baseRequest);

    expect(args.slice(0, 2)).toEqual(['-p', 'review this']);
    expect(flagValue(args, '--output-format')).toBe('json');
    expect(flagValue(args, '--tools')).toBe('');
    expect(flagValue(args, '--setting-sources')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--max-budget-usd');
    expect(args).not.toContain('--max-turns');
  });

  it('sandboxes every judge: confined to the working dir, never prompting, no write tools', () => {
    const args = buildClaudeArgs(baseRequest);

    expect(args).toContain('--restricted');
    expect(flagValue(args, '--permission-mode')).toBe('dontAsk');
    expect(flagValue(args, '--permission-prompts')).toBe('none');
    expect(flagValue(args, '--disallowedTools')).toBe('Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch');
  });

  it('streams events for agent judges so tool calls can be recorded', () => {
    const args = buildClaudeArgs(agentRequest);

    expect(flagValue(args, '--output-format')).toBe('stream-json');
    expect(args).toContain('--verbose');
  });

  it('maps model, tools, budget and turn cap when set', () => {
    const args = buildClaudeArgs({ ...baseRequest, model: 'small', tools: ['Read', 'Grep'], maxBudgetUsd: 0.25, maxTurns: 5 });

    expect(flagValue(args, '--model')).toBe('haiku');
    expect(flagValue(args, '--tools')).toBe('Read,Grep');
    expect(flagValue(args, '--max-budget-usd')).toBe('0.25');
    expect(flagValue(args, '--max-turns')).toBe('5');
  });
});

describe('claudeWorkingDir', () => {
  it('runs one-shot judges in a neutral temp dir so no repo CLAUDE.md is picked up', () => {
    expect(claudeWorkingDir(baseRequest)).toBe(os.tmpdir());
  });

  it('runs agent judges in the repository root so they can explore it', () => {
    expect(claudeWorkingDir(agentRequest)).toBe('/repo');
  });
});

describe('agent mode support', () => {
  it.each([codexEngine, geminiEngine])('$name fails an agent judge instead of running it one-shot', async (engine) => {
    await expect(engine.run(agentRequest)).rejects.toThrow(`agent mode not supported by ${engine.name}`);
  });
});

describe('buildCodexArgs and buildGeminiArgs', () => {
  it('pass the prompt and ignore unsupported fields', () => {
    const request = { ...baseRequest, tools: ['Read'], maxBudgetUsd: 1, maxTurns: 3 };

    expect(buildCodexArgs(request)).toEqual(['exec', 'review this']);
    expect(buildGeminiArgs(request)).toEqual(['-p', 'review this']);
  });

  it('map an exact model id to --model', () => {
    expect(buildCodexArgs({ ...baseRequest, model: 'gpt-5' })).toEqual(['exec', 'review this', '--model', 'gpt-5']);
    expect(buildGeminiArgs({ ...baseRequest, model: 'gemini-2.5-pro' })).toEqual(['-p', 'review this', '--model', 'gemini-2.5-pro']);
  });
});

describe('interpretClaudeOutput', () => {
  it('extracts result text, cost and turns from the JSON envelope', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: '[]', total_cost_usd: 0.0123, num_turns: 1 });

    expect(interpretClaudeOutput(stdout, baseRequest)).toEqual({ rawOutput: '[]', costUsd: 0.0123, turns: 1 });
  });

  it('leaves cost and turns undefined when the envelope lacks them', () => {
    const stdout = JSON.stringify({ type: 'result', result: '[]' });

    expect(interpretClaudeOutput(stdout, baseRequest)).toEqual({ rawOutput: '[]', costUsd: undefined, turns: undefined });
  });

  it('falls back to the plain stdout when it is not a JSON envelope', () => {
    expect(interpretClaudeOutput('[{"file":"a.ts"}]', baseRequest)).toEqual({ rawOutput: '[{"file":"a.ts"}]' });
    expect(interpretClaudeOutput('plain text', baseRequest)).toEqual({ rawOutput: 'plain text' });
  });

  it('throws when the envelope reports an error', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: true, result: 'budget exceeded' });

    expect(() => interpretClaudeOutput(stdout, baseRequest)).toThrow('budget exceeded');
  });

  it('names the budget limit when the budget is exceeded', () => {
    const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: null, errors: ['Reached maximum budget ($0.1)'] });

    expect(() => interpretClaudeOutput(stdout, { ...baseRequest, maxBudgetUsd: 0.1 })).toThrow('claude CLI stopped: budget exceeded ($0.1)');
  });
});

describe('explainClaudeFailure', () => {
  it('explains budget and turn limits from the error envelope of a failed exit', () => {
    const budget = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: null });
    const turns = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true });

    expect(explainClaudeFailure(budget, { ...baseRequest, maxBudgetUsd: 0.05 })).toBe('budget exceeded ($0.05)');
    expect(explainClaudeFailure(turns, { ...baseRequest, maxTurns: 3 })).toBe('turn limit reached (3)');
  });

  it('uses the reported errors for other failures and nothing for non-JSON output', () => {
    const other = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] });

    expect(explainClaudeFailure(other, baseRequest)).toBe('boom');
    expect(explainClaudeFailure('Segmentation fault', baseRequest)).toBeUndefined();
  });
});

describe('interpretClaudeOutput for agent streams', () => {
  const toolUse = (id: string, name: string, input: object) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const stream = (...lines: string[]) => lines.join('\n');

  it('takes the result from the final event and records every tool call', () => {
    const stdout = stream(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      toolUse('t1', 'Glob', { pattern: 'tests/**/*.py' }),
      JSON.stringify({ type: 'user', message: { content: [] } }),
      toolUse('t2', 'Read', { file_path: '/repo/tests/integration/test_alpha.py' }),
      toolUse('t3', 'Grep', { pattern: 'beta', path: '/repo/tests' }),
      toolUse('t4', 'Read', { file_path: '/tmp/outside.txt' }),
      JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, result: '[]', total_cost_usd: 0.02, num_turns: 5,
        permission_denials: [{ tool_use_id: 't4', tool_name: 'Read' }]
      })
    );

    expect(interpretClaudeOutput(stdout, agentRequest)).toEqual({
      rawOutput: '[]',
      costUsd: 0.02,
      turns: 5,
      examined: [
        { tool: 'Glob', target: 'tests/**/*.py' },
        { tool: 'Read', target: 'tests/integration/test_alpha.py' },
        { tool: 'Grep', target: 'beta in tests' },
        { tool: 'Read', target: '/tmp/outside.txt', denied: true },
      ]
    });
  });

  it('records an empty list for an agent that used no tools', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: '[]' });

    expect(interpretClaudeOutput(stdout, agentRequest).examined).toEqual([]);
  });

  it('reports stream failures the same way as the JSON envelope', () => {
    const stdout = stream(toolUse('t1', 'Read', { file_path: '/repo/a.py' }),
      JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }));

    expect(() => interpretClaudeOutput(stdout, { ...agentRequest, maxTurns: 8 })).toThrow('turn limit reached (8)');
    expect(explainClaudeFailure(stdout, { ...agentRequest, maxTurns: 8 })).toBe('turn limit reached (8)');
  });
});

