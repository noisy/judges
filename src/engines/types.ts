import { SupportedEngine } from '../types.js';

export interface EngineRequest {
  prompt: string;
  mode: 'one-shot' | 'agent';
  cwd?: string; // repository root an agent judge explores; one-shot judges read nothing from disk
  model?: string;
  timeoutMs: number;
  maxBudgetUsd?: number;
  tools: string[];
  maxTurns?: number;
}

export interface EngineResponse {
  rawOutput: string;
  costUsd?: number;
  turns?: number;
  durationMs: number;
}

export interface Engine {
  name: SupportedEngine;
  isAvailable(): boolean;
  run(req: EngineRequest): Promise<EngineResponse>;
}
