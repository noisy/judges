import { Issue } from './types.js';

export function parseLLMOutput(rawOutput: string): Issue[] {
  let jsonStr = rawOutput;
  const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed as Issue[];
    }
    throw new Error("Parsed object is not an array.");
  } catch (e: any) {
    throw new Error(`Failed to parse LLM output. Raw: ${rawOutput}`);
  }
}
