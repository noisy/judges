import { EngineRequest } from './types.js';
import { createCliEngine } from './process.js';
import { resolveModel } from './models.js';

// gemini -p has no flags for tools, budget or turn cap; those fields are ignored.
export function buildGeminiArgs(req: EngineRequest): string[] {
  const args = ['-p', req.prompt];
  const model = resolveModel('gemini', req.model);
  if (model) args.push('--model', model);
  return args;
}

export const geminiEngine = createCliEngine({
  name: 'gemini',
  buildArgs: buildGeminiArgs,
  interpretOutput: (stdout) => ({ rawOutput: stdout })
});
