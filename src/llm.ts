import { spawn } from 'child_process';
import { spawnSync } from 'child_process';

export interface Issue {
  file: string;
  line: string | number;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export const MOCK_DELAY_BASE_MS = 1000;
export const MOCK_DELAY_RANGE_MS = 2000;

export function checkLLMAvailability(engine: 'claude' | 'codex' = 'claude'): boolean {
  const check = spawnSync('which', [engine], { encoding: 'utf-8' });
  return check.status === 0;
}

export async function mockLLMResponse(engine: 'claude' | 'codex' = 'claude'): Promise<Issue[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          file: "dummy.ts",
          line: 10,
          severity: "low",
          message: `MOCK: This is a placeholder because the ${engine} CLI is not available.`
        }
      ]);
    }, MOCK_DELAY_BASE_MS + Math.random() * MOCK_DELAY_RANGE_MS);
  });
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

export async function executeLLM(prompt: string, engine: 'claude' | 'codex' = 'claude'): Promise<Issue[]> {
  if (!checkLLMAvailability(engine)) {
    return mockLLMResponse(engine);
  }

  return new Promise((resolve, reject) => {
    // Sanitize the prompt to absolutely guarantee no null bytes reach spawn().
    const safePrompt = prompt.replace(/\0/g, '');

    const args = engine === 'codex' ? ['exec', safePrompt] : ['-p', safePrompt];

    const child = spawn(engine, args, { 
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${engine}: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
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
