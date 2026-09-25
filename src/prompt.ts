import { Judge } from './judges.js';
import { Marker } from './markers.js';
import { EvaluationContext } from './types.js';

const LINE_NUMBER_SEPARATOR = '| ';

export function constructPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[] = []): string {
  return judge.mode === 'agent'
    ? constructAgentPrompt(judge, inputContext, markers)
    : constructOneShotPrompt(judge, inputContext, markers);
}

function constructOneShotPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[]): string {
  let contextSection = '';

  if (inputContext.type === 'diff') {
    contextSection = `${diffSection(inputContext)}
# Full file contents (Read-Only Context)
`;
  } else {
    contextSection = `# Full file contents\n`;
  }

  contextSection += fileBlocks(inputContext);

  return `${outputContract()}
Judge Name: ${judge.name || judge.id}
Instructions to follow for your evaluation:
${judge.instructions}

${markersSection(markers)}Input Context to Review:
${contextSection}
`;
}

// The inline files are what is being committed; the working tree the agent can read may differ.
function constructAgentPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[]): string {
  const diff = inputContext.type === 'diff' ? diffSection(inputContext) : '';

  return `${outputContract()}
Judge Name: ${judge.name || judge.id}
Rule to verify:
${judge.instructions}

# Changed files in scope (the content being committed; the files on disk may differ)
${fileBlocks(inputContext)}${diff}
${markersSection(markers)}Verify the rule against the repository. You may read other files, search, list directories: sibling modules, tests, imports. Report only violations in the changed files in scope. Finish with the JSON array only.
`;
}

function outputContract(): string {
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

File contents are shown with a line number before each line, like \`  17${LINE_NUMBER_SEPARATOR}code\`. Report those numbers in "line"; the prefix is not part of the code.
`;
}

function diffSection(inputContext: EvaluationContext): string {
  return `
# Diff
\`\`\`diff
${inputContext.rawDiff}
\`\`\`
`;
}

function fileBlocks(inputContext: EvaluationContext): string {
  return inputContext.files
    .map((file) => `## ${file.path}\n\`\`\`\n${numberLines(file.content)}\n\`\`\`\n\n`)
    .join('');
}

// "  7| code": models report off-by-one lines without them, and marker suppression matches on lines.
export function numberLines(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width)}${LINE_NUMBER_SEPARATOR}${line}`).join('\n');
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
