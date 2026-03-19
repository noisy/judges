import { Judge } from './judges.js';

export function constructPrompt(judge: Judge, inputContext: string): string {
  // A simple prompt template
  return `You are acting as an AI judge for code quality or other criteria.
Please review the following input context based on the instructions provided.

Judge Name: ${judge.name || judge.id}
Instructions:
${judge.instructions}

Input Context to Review:
${inputContext}

Please provide your review based strictly on the instructions above.
`;
}
