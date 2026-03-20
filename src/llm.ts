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

export function checkLLMAvailability(): boolean {
  const check = spawnSync('which', ['claude'], { encoding: 'utf-8' });
  return check.status === 0;
}

export async function mockLLMResponse(): Promise<Issue[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          file: "dummy.ts",
          line: 10,
          severity: "low",
          message: "MOCK: This is a placeholder because the claude CLI is not available."
        }
      ]);
    }, MOCK_DELAY_BASE_MS + Math.random() * MOCK_DELAY_RANGE_MS);
  });
}

export function parseLLMOutput(rawOutput: string): Issue[] {
  try {
    let jsonStr = rawOutput;
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed as Issue[];
    }
    return [];
  } catch (e) {
    console.error("Failed to parse LLM output as JSON. Raw output was:", rawOutput);
    return [];
  }
}

export async function executeLLM(prompt: string): Promise<Issue[]> {
  if (!checkLLMAvailability()) {
    return mockLLMResponse();
  }

  return new Promise((resolve, reject) => {
    // Sanitize the prompt to absolutely guarantee no null bytes reach spawn().
    const safePrompt = prompt.replace(/\0/g, '');

    const child = spawn('claude', ['-p', safePrompt], { 
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
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Claude CLI exited with status ${code}: ${stderrData}`));
      }

      const rawOutput = stdoutData.trim();
      resolve(parseLLMOutput(rawOutput));
    });
  });
}
