import { Judge } from './judges.js';
import { Marker } from './markers.js';
import { EvaluationContext } from './types.js';

export function constructPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[] = []): string {
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

${markersSection(markers)}Input Context to Review:
${contextSection}
`;
}

// The judge contract: marked places are accounted for, so the judge need not report them.
export function markersSection(markers: Marker[]): string {
  if (markers.length === 0) return '';
  const entries = markers.map((marker) => `- ${markerLocation(marker)} (rule-${marker.kind}): ${marker.reason}`);
  return `Markers (accounted for, do not report findings at these places):
${entries.join('\n')}

`;
}

function markerLocation(marker: Marker): string {
  return marker.scope === 'file' ? `${marker.file} (whole file)` : `${marker.file}:${marker.scope.line}`;
}
