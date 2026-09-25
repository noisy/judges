import { SupportedEngine } from '../types.js';

export type ModelAlias = 'small' | 'medium' | 'large';

// An alias without a mapping falls back to the engine's default model.
const MODEL_ALIASES: Record<SupportedEngine, Partial<Record<ModelAlias, string>>> = {
  claude: { small: 'haiku', medium: 'sonnet', large: 'opus' },
  codex: {},
  gemini: {}
};

export function resolveModel(engine: SupportedEngine, model?: string): string | undefined {
  if (!model) return undefined;
  if (isModelAlias(model)) return MODEL_ALIASES[engine][model];
  return model;
}

function isModelAlias(model: string): model is ModelAlias {
  return model === 'small' || model === 'medium' || model === 'large';
}
