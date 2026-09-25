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
  interpretOutput(stdout: string): OutputInterpretation;
}

export function createCliEngine(adapter: CliAdapter): Engine {
  const isAvailable = () => isCommandAvailable(adapter.name);
  return {
    name: adapter.name,
    isAvailable,
    async run(req) {
      if (!isAvailable()) {
        throw new Error(`${adapter.name} CLI not found on PATH`);
      }
      const args = adapter.buildArgs({ ...req, prompt: stripNullBytes(req.prompt) });
      const startedAt = Date.now();
      const stdout = await runCli(adapter.name, args, req.timeoutMs);
      return { ...adapter.interpretOutput(stdout), durationMs: Date.now() - startedAt };
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

function runCli(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
      if (code !== 0 && code !== null) {
        return reject(exitError(command, code, stderrData.trim() || stdoutData.trim()));
      }
      resolve(stdoutData.trim());
    });
  });
}

function exitError(command: string, code: number, details: string): Error {
  if (details.includes("You've hit your usage limit") || details.toLowerCase().includes('rate limit')) {
    return new Error('API Error: Rate limit reached');
  }
  return new Error(`${command} CLI exited with status ${code}: ${details}`);
}
