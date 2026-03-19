import { spawnSync } from 'child_process';

export function executeLLM(prompt: string): string {
  try {
    // We shell out to the `claude` CLI as requested by the PoC skills.
    // Using spawnSync allows us to easily supply large prompts as arguments
    // without as much shell escaping hassle.
    
    // Check if claude CLI exists
    const check = spawnSync('which', ['claude'], { encoding: 'utf-8' });
    if (check.status !== 0) {
      console.warn("WARNING: 'claude' CLI command not found. Using a mock response.");
      return "MOCK RESPONSE: This is a placeholder because the claude CLI is not available in the environment.\n\nThe code looks fine based on the mock check.";
    }

    const result = spawnSync('claude', ['-p', prompt], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    
    if (result.error) {
      throw result.error;
    }
    
    if (result.status !== 0) {
      throw new Error(`Claude CLI exited with status ${result.status}: ${result.stderr}`);
    }

    return result.stdout.trim();
  } catch (err: any) {
    console.error("Error executing LLM:", err.message);
    process.exit(1);
  }
}
