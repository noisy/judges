import { spawnSync } from 'child_process';

export interface Issue {
  file: string;
  line: string | number;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export function executeLLM(prompt: string): Issue[] {
  try {
    // We shell out to the `claude` CLI as requested by the PoC skills.
    // Using spawnSync allows us to easily supply large prompts as arguments
    // without as much shell escaping hassle.
    
    // Check if claude CLI exists
    const check = spawnSync('which', ['claude'], { encoding: 'utf-8' });
    if (check.status !== 0) {
      console.warn("WARNING: 'claude' CLI command not found. Using a mock response.");
      return [
        {
          file: "dummy.ts",
          line: 10,
          severity: "low",
          message: "MOCK: This is a placeholder because the claude CLI is not available."
        }
      ];
    }

    const result = spawnSync('claude', ['-p', prompt], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    
    if (result.error) {
      throw result.error;
    }
    
    if (result.status !== 0) {
      throw new Error(`Claude CLI exited with status ${result.status}: ${result.stderr}`);
    }

    const rawOutput = result.stdout.trim();
    
    // Extract JSON array from the response if it's wrapped in markdown
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
  } catch (err: any) {
    console.error("Error executing LLM:", err.message);
    process.exit(1);
  }
}
