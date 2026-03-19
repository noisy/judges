import { spawn } from 'child_process';
import { spawnSync } from 'child_process';

export interface Issue {
  file: string;
  line: string | number;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export async function executeLLM(prompt: string): Promise<Issue[]> {
  return new Promise((resolve, reject) => {
    // Fast synchronous check if claude is available
    const check = spawnSync('which', ['claude'], { encoding: 'utf-8' });
    if (check.status !== 0) {
      // Mock response for testing without claude CLI
      setTimeout(() => {
        resolve([
          {
            file: "dummy.ts",
            line: 10,
            severity: "low",
            message: "MOCK: This is a placeholder because the claude CLI is not available."
          }
        ]);
      }, 1000 + Math.random() * 2000); // simulate async delay
      return;
    }

    const child = spawn('claude', ['-p', prompt], { 
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
      
      // Extract JSON array from the response if it's wrapped in markdown
      try {
        let jsonStr = rawOutput;
        const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          resolve(parsed as Issue[]);
        } else {
          resolve([]);
        }
      } catch (e) {
        console.error("Failed to parse LLM output as JSON. Raw output was:", rawOutput);
        resolve([]);
      }
    });
  });
}
