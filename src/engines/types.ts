import { ExaminedTarget, SupportedEngine } from '../types.js';

export interface EngineRequest {
  prompt: string;
  mode: 'one-shot' | 'agent';
  cwd?: string; // repository root an agent judge explores; one-shot judges read nothing from disk
  model?: string;
  timeoutMs: number;
  maxBudgetUsd?: number;
  tools: string[];
  allowRead: string[]; // allow_read patterns, resolved against cwd by the adapter
  maxTurns?: number;
}

export interface EngineResponse {
  rawOutput: string;
  costUsd?: number;
  turns?: number;
  examined?: ExaminedTarget[];
  durationMs: number;
}

export interface Engine {
  name: SupportedEngine;
  isAvailable(): boolean;
  run(req: EngineRequest): Promise<EngineResponse>;
}
