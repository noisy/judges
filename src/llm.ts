import { Issue, SupportedEngine } from './types.js';
import { spawn } from 'child_process';
import { spawnSync } from 'child_process';

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function executeLLM(prompt: string, engine: SupportedEngine = 'claude', timeoutMs: number = 30000): Promise<Issue[]> {
  if (!checkLLMAvailability(engine)) {
    throw new Error(`${engine} CLI not found on PATH`);
  }

  return new Promise((resolve, reject) => {
    // Sanitize the prompt to absolutely guarantee no null bytes reach spawn().
    const safePrompt = prompt.replace(/\0/g, '');

    const ENGINE_COMMANDS: Record<SupportedEngine, (p: string) => string[]> = {
      claude: (p) => ['-p', p],
      codex: (p) => ['exec', p],
      gemini: (p) => ['-p', p]
    };

    const args = ENGINE_COMMANDS[engine] ? ENGINE_COMMANDS[engine](safePrompt) : ENGINE_COMMANDS['claude'](safePrompt);

    const child = spawn(engine, args, { 
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    const timeoutRef = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TimeoutError(`${engine} CLI timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeoutRef);
      reject(new Error(`Failed to spawn ${engine}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutRef);
      if (code !== 0 && code !== null) {
        let errorDetails = stderrData.trim() || stdoutData.trim();
        
        if (errorDetails.includes("You've hit your usage limit") || errorDetails.toLowerCase().includes("rate limit")) {
          return reject(new Error(`API Error: Rate limit reached`));
        }
        
        return reject(new Error(`${engine} CLI exited with status ${code}: ${errorDetails}`));
      }

      const rawOutput = stdoutData.trim();
      try {
        resolve(parseLLMOutput(rawOutput));
      } catch (err: any) {
        reject(err);
      }
    });
  });
}

export function checkLLMAvailability(engine: SupportedEngine = 'claude'): boolean {
  const check = spawnSync('which', [engine], { encoding: 'utf-8' });
  return check.status === 0;
}

export function parseLLMOutput(rawOutput: string): Issue[] {
  let jsonStr = rawOutput;
  const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed as Issue[];
    }
    throw new Error("Parsed object is not an array.");
  } catch (e: any) {
    throw new Error(`Failed to parse LLM output. Raw: ${rawOutput}`);
  }
}
