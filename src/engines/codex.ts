import { EngineRequest } from './types.js';
import { createCliEngine } from './process.js';
import { resolveModel } from './models.js';

// codex exec has no flags for tools, budget or turn cap; those fields are ignored.
export function buildCodexArgs(req: EngineRequest): string[] {
  const args = ['exec', req.prompt];
  const model = resolveModel('codex', req.model);
  if (model) args.push('--model', model);
  return args;
}

export const codexEngine = createCliEngine({
  name: 'codex',
  buildArgs: buildCodexArgs,
  interpretOutput: (stdout) => ({ rawOutput: stdout })
});
