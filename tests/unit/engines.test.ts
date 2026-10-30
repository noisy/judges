import os from 'os';
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, claudeStopReason, claudeUsageBeforeKill, claudeWorkingDir, explainClaudeFailure, interpretClaudeOutput,
  readAccessArgs, reportedClaudeUsage } from '../../src/engines/claude.js';
import { createCliEngine, EngineStoppedError } from '../../src/engines/process.js';
import { buildCodexArgs, codexEngine } from '../../src/engines/codex.js';
import { buildGeminiArgs, geminiEngine } from '../../src/engines/gemini.js';
import { resolveModel } from '../../src/engines/models.js';
import { EngineRequest } from '../../src/engines/types.js';
import { SupportedEngine, UNKNOWN_TOKENS } from '../../src/types.js';

const baseRequest: EngineRequest = { prompt: 'review this', mode: 'one-shot', timeoutMs: 30000, tools: [], allowRead: [] };
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
    expect(flagValue(args, '--output-format')).toBe('stream-json');
    expect(args).toEqual(expect.arrayContaining(['--verbose', '--include-partial-messages']));
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

  it.each([baseRequest, agentRequest])('passes effort as it is, and no --effort when unset (%#)', (request) => {
    expect(flagValue(buildClaudeArgs({ ...request, effort: 'xhigh' }), '--effort')).toBe('xhigh');
    expect(buildClaudeArgs(request)).not.toContain('--effort');
  });
});

describe('readAccessArgs', () => {
  const secretDenies = ['Read(//**/.env*)', 'Read(//**/.ssh/**)', 'Read(//**/.aws/**)', 'Read(//**/.claude*/**)',
    'Read(//**/*.pem)', 'Read(//**/*key*.json)'];
  const settingsOf = (args: string[]) => JSON.parse(flagValue(args, '--settings')!).permissions;

  it('keeps a judge to the repo and still denies secrets when nothing is allowed', () => {
    const args = readAccessArgs([], '/work/orders');

    expect(args).not.toContain('--add-dir');
    expect(settingsOf(args)).toEqual({ allow: [], deny: secretDenies });
  });

  it('adds each allowed directory, resolved against the repo root, with a matching allow rule', () => {
    const args = readAccessArgs(['../billing-service/**', '../shared-contracts', '/srv/specs/**', '~/contracts/**'], '/work/orders', '/home/dev');

    expect(args.filter((_, i) => args[i - 1] === '--add-dir'))
      .toEqual(['/work/billing-service', '/work/shared-contracts', '/srv/specs', '/home/dev/contracts']);
    expect(settingsOf(args)).toEqual({
      allow: ['Read(//work/billing-service/**)', 'Read(//work/shared-contracts/**)', 'Read(//srv/specs/**)', 'Read(//home/dev/contracts/**)'],
      deny: secretDenies
    });
  });

  it('is part of every claude run', () => {
    const args = buildClaudeArgs({ ...agentRequest, allowRead: ['../billing-service/**'] });

    expect(flagValue(args, '--add-dir')).toBe('/billing-service');
    expect(settingsOf(args).deny).toEqual(secretDenies);
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
    const request = { ...baseRequest, tools: ['Read'], maxBudgetUsd: 1, maxTurns: 3, effort: 'high' };

    expect(buildCodexArgs(request)).toEqual(['exec', 'review this']);
    expect(buildGeminiArgs(request)).toEqual(['-p', 'review this']);
  });

  it('map an exact model id to --model', () => {
    expect(buildCodexArgs({ ...baseRequest, model: 'gpt-5' })).toEqual(['exec', 'review this', '--model', 'gpt-5']);
    expect(buildGeminiArgs({ ...baseRequest, model: 'gemini-2.5-pro' })).toEqual(['-p', 'review this', '--model', 'gemini-2.5-pro']);
  });
});

describe('interpretClaudeOutput', () => {
  it('extracts result text, cost, tokens and turns from the JSON envelope', () => {
    const usage = { input_tokens: 1200, cache_read_input_tokens: 800, output_tokens: 40 };
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: '[]', total_cost_usd: 0.0123, num_turns: 1, usage });

    expect(interpretClaudeOutput(stdout, baseRequest)).toEqual({
      rawOutput: '[]', costUsd: 0.0123, turns: 1, tokens: { input: 1200, cacheCreation: 0, cacheRead: 800, output: 40 }
    });
  });

  it('leaves cost, tokens and turns unknown when the envelope lacks them', () => {
    const stdout = JSON.stringify({ type: 'result', result: '[]' });

    expect(interpretClaudeOutput(stdout, baseRequest)).toEqual({
      rawOutput: '[]', costUsd: undefined, turns: undefined, tokens: UNKNOWN_TOKENS
    });
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

  it('keeps the cost, tokens and turns of a run stopped by its budget, cache writes apart', () => {
    const usage = { input_tokens: 1200, cache_creation_input_tokens: 300, output_tokens: 40 };
    const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.011, num_turns: 1, usage });

    expect(stoppedUsage(() => interpretClaudeOutput(stdout, { ...baseRequest, maxBudgetUsd: 0.01 })))
      .toEqual({ costUsd: 0.011, turns: 1, tokens: { input: 1200, cacheCreation: 300, cacheRead: 0, output: 40 } });
  });
});

function stoppedUsage(run: () => unknown): unknown {
  return stopOf(run).usage;
}

function stopOf(run: () => unknown): EngineStoppedError {
  try {
    run();
  } catch (error) {
    if (error instanceof EngineStoppedError) return error;
    throw error;
  }
  throw new Error('expected the run to stop');
}

describe('claude stop reasons', () => {
  const envelope = (subtype: string) => JSON.stringify({ type: 'result', subtype, is_error: true, errors: ['boom'] });

  it('names the limit a run stopped on, and none for a run that failed', () => {
    expect(stopOf(() => interpretClaudeOutput(envelope('error_max_turns'), baseRequest)).stopReason).toBe('turns');
    expect(stopOf(() => interpretClaudeOutput(envelope('error_max_budget_usd'), baseRequest)).stopReason).toBe('cost');
    expect(stopOf(() => interpretClaudeOutput(envelope('error_during_execution'), baseRequest)).stopReason).toBeUndefined();
  });

  it('reads the same limit from the output of a failed exit', () => {
    expect(claudeStopReason(envelope('error_max_turns'))).toBe('turns');
    expect(claudeStopReason(envelope('error_max_budget_usd'))).toBe('cost');
    expect(claudeStopReason(envelope('error_during_execution'))).toBeUndefined();
    expect(claudeStopReason('Segmentation fault')).toBeUndefined();
  });
});

describe('claudeUsageBeforeKill', () => {
  it('counts the turns and tool calls an agent streamed before the kill, and leaves the cost unknown', () => {
    const stdout = stream(toolUse('t1', 'Glob', { pattern: 'tests/**/*.py' }), toolUse('t2', 'Read', { file_path: '/repo/a.py' }));

    expect(claudeUsageBeforeKill(stdout, agentRequest)).toMatchObject({
      turns: 2,
      examined: [{ tool: 'Glob', target: 'tests/**/*.py' }, { tool: 'Read', target: 'a.py' }]
    });
  });

  it('counts a message printed as several events once', () => {
    const block = (type: string) => JSON.stringify({ type: 'assistant', message: { id: 'msg_1', content: [{ type }] } });

    expect(claudeUsageBeforeKill(stream(block('thinking'), block('text')), agentRequest).turns).toBe(1);
  });

  it('counts no turns for an agent killed before it printed anything, and leaves one-shot runs to the caller', () => {
    expect(claudeUsageBeforeKill('', agentRequest)).toMatchObject({ turns: 0, examined: [] });
    expect(claudeUsageBeforeKill('', baseRequest)).not.toHaveProperty('turns');
  });
});

describe('time limit', () => {
  it('kills the run and stops it on time, with the usage read from what it printed', async () => {
    const engine = createCliEngine({
      name: 'sh' as SupportedEngine,
      buildArgs: () => ['-c', 'echo one; echo two; sleep 5'],
      interpretOutput: (stdout) => ({ rawOutput: stdout }),
      usageBeforeKill: (stdout) => ({ turns: stdout.split('\n').length })
    });

    const stop = await engine.run({ ...baseRequest, timeoutMs: 300 }).catch((error) => error);

    expect(stop).toBeInstanceOf(EngineStoppedError);
    expect(stop).toMatchObject({ stopReason: 'time', usage: { turns: 2 }, message: 'sh CLI timed out after 0.3 seconds.' });
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

const toolUse = (id: string, name: string, input: object) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const stream = (...lines: string[]) => lines.join('\n');

describe('interpretClaudeOutput for agent streams', () => {

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
      tokens: UNKNOWN_TOKENS,
      turns: 5,
      examined: [
        { tool: 'Glob', target: 'tests/**/*.py' },
        { tool: 'Read', target: 'tests/integration/test_alpha.py' },
        { tool: 'Grep', target: 'beta in tests' },
        { tool: 'Read', target: '/tmp/outside.txt', denied: true },
      ]
    });
  });

  it('ignores an array the model wrote in an earlier turn', () => {
    const draft = JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'Draft: [{"file":"a.py","line":2,"message":"x"}]' }] }
    });
    const stdout = stream(draft, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '[]' }));

    expect(interpretClaudeOutput(stdout, agentRequest).rawOutput).toBe('[]');
  });

  it('shows the full path for reads outside the repo, so a use of allow_read is visible', () => {
    const stdout = stream(toolUse('t1', 'Read', { file_path: '../billing-service/api.py' }),
      toolUse('t2', 'Grep', { pattern: 'def charge', path: '/billing-service' }),
      JSON.stringify({ type: 'result', is_error: false, result: '[]' }));

    expect(interpretClaudeOutput(stdout, agentRequest).examined).toEqual([
      { tool: 'Read', target: '/billing-service/api.py' },
      { tool: 'Grep', target: 'def charge in /billing-service' },
    ]);
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

  it('keeps the cost, turns and tool calls of a run stopped by its turn cap, whatever the exit code', () => {
    const stdout = stream(toolUse('t1', 'Read', { file_path: '/repo/tests/test_greet.py' }),
      JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.034, num_turns: 2 }));
    const usage = { costUsd: 0.034, tokens: UNKNOWN_TOKENS, turns: 2, examined: [{ tool: 'Read', target: 'tests/test_greet.py' }] };

    expect(stoppedUsage(() => interpretClaudeOutput(stdout, { ...agentRequest, maxTurns: 2 }))).toEqual(usage);
    expect(reportedClaudeUsage(stdout, { ...agentRequest, maxTurns: 2 })).toEqual(usage);
  });

  it('reports no usage when the output is not CLI JSON', () => {
    expect(reportedClaudeUsage('Segmentation fault', agentRequest)).toEqual({});
  });
});

