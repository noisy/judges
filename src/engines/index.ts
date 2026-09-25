import { SupportedEngine } from '../types.js';
import { Engine } from './types.js';
import { claudeEngine } from './claude.js';
import { codexEngine } from './codex.js';
import { geminiEngine } from './gemini.js';

export { TimeoutError } from './process.js';
export type { Engine, EngineRequest, EngineResponse } from './types.js';

const ENGINES: Record<SupportedEngine, Engine> = {
  claude: claudeEngine,
  codex: codexEngine,
  gemini: geminiEngine
};

export function getEngine(name: SupportedEngine): Engine {
  return ENGINES[name] ?? ENGINES.claude;
}
