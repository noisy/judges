import { ExaminedTarget, SupportedEngine, TokenUsage } from '../types.js';

export interface EngineRequest {
  prompt: string;
  mode: 'one-shot' | 'agent';
  cwd?: string; // repository root an agent judge explores; one-shot judges read nothing from disk
  model?: string;
  effort?: string; // passed as it is; the engine's default when unset
  timeoutMs: number;
  maxBudgetUsd?: number;
  tools: string[];
  allowRead: string[]; // allow_read patterns, resolved against cwd by the adapter
  maxTurns?: number;
}

export interface EngineResponse {
  rawOutput: string;
  costUsd?: number;
  costEstimated?: boolean;
  tokens?: TokenUsage;
  tokensEstimated?: boolean;
  turns?: number;
  examined?: ExaminedTarget[];
  durationMs: number;
}

export interface Engine {
  name: SupportedEngine;
  isAvailable(): boolean;
  run(req: EngineRequest): Promise<EngineResponse>;
}
