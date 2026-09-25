import { spawn, spawnSync } from 'child_process';
import { SupportedEngine } from '../types.js';
import { Engine, EngineRequest, EngineResponse } from './types.js';

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export type OutputInterpretation = Omit<EngineResponse, 'durationMs'>;

interface CliAdapter {
  name: SupportedEngine;
  buildArgs(req: EngineRequest): string[];
  supportsAgentMode?: boolean;
  interpretOutput(stdout: string, req: EngineRequest): OutputInterpretation;
  // Directory to run the CLI in; the current one when undefined.
  workingDir?(req: EngineRequest): string | undefined;
  // Human-readable reason for a non-zero exit, read from the CLI's own output.
  explainFailure?(stdout: string, req: EngineRequest): string | undefined;
}

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function createCliEngine(adapter: CliAdapter): Engine {
  const isAvailable = () => isCommandAvailable(adapter.name);
  return {
    name: adapter.name,
    isAvailable,
    async run(req) {
      // A one-shot fallback would pass a rule it never checked, so an agent judge fails instead.
      if (req.mode === 'agent' && !adapter.supportsAgentMode) {
        throw new Error(`agent mode not supported by ${adapter.name}`);
      }
      if (!isAvailable()) {
        throw new Error(`${adapter.name} CLI not found on PATH`);
      }
      const args = adapter.buildArgs({ ...req, prompt: stripNullBytes(req.prompt) });
      const startedAt = Date.now();
      const result = await runCli(adapter.name, args, req.timeoutMs, adapter.workingDir?.(req));
      if (result.exitCode !== 0 && result.exitCode !== null) {
        throw exitError(adapter.name, result, adapter.explainFailure?.(result.stdout, req));
      }
      return { ...adapter.interpretOutput(result.stdout, req), durationMs: Date.now() - startedAt };
    }
  };
}

export function isCommandAvailable(command: string): boolean {
  const check = spawnSync('which', [command], { encoding: 'utf-8' });
  return check.status === 0;
}

// Null bytes make spawn() throw, so they never reach the CLI.
function stripNullBytes(text: string): string {
  return text.replace(/\0/g, '');
}

function runCli(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });

    let stdoutData = '';
    let stderrData = '';

    const timeoutRef = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TimeoutError(`${command} CLI timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeoutRef);
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutRef);
      resolve({ exitCode: code, stdout: stdoutData.trim(), stderr: stderrData.trim() });
    });
  });
}

function exitError(command: string, result: CliResult, explanation?: string): Error {
  if (explanation) {
    return new Error(`${command} CLI stopped: ${explanation}`);
  }
  const details = result.stderr || result.stdout;
  if (details.includes("You've hit your usage limit") || details.toLowerCase().includes('rate limit')) {
    return new Error('API Error: Rate limit reached');
  }
  return new Error(`${command} CLI exited with status ${result.exitCode}: ${details}`);
}
