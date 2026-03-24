import { Judge } from './judges.js';
import { EvaluationContext } from './types.js';

export function constructPrompt(judge: Judge, inputContext: EvaluationContext): string {
  let contextSection = '';

  if (inputContext.type === 'diff') {
    contextSection = `
# Diff
\`\`\`diff
${inputContext.rawDiff}
\`\`\`

# Full file contents (Read-Only Context)
`;
  } else {
    contextSection = `# Full file contents\n`;
  }

  for (const file of inputContext.files) {
    contextSection += `## ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
  }

  return `You are acting as an AI judge verifying code quality or other criteria.
You MUST output your review in strict JSON format. Do not include any other text, markdown formatting (no \`\`\`json wrappers), or explanations outside of the JSON array.
You MUST write all your evaluation messages in English.

Your output must be a JSON array of objects. Each object represents an issue you found, matching this exact schema:
[
  {
    "file": "string (the filepath of the file with the issue, or global if it's general)",
    "line": "number | string (the line number, or range, or 'N/A')",
    "severity": "low | medium | high",
    "message": "string (a detailed explanation of the issue and how to fix it)"
  }
]

If you find absolutely no issues, return an empty array: []

Judge Name: ${judge.name || judge.id}
Instructions to follow for your evaluation:
${judge.instructions}

Input Context to Review:
${contextSection}
`;
}
