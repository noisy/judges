import { Judge } from './judges.js';
import { Marker, markerPlace } from './markers.js';
import { EvaluationContext } from './types.js';

const LINE_NUMBER_SEPARATOR = '| ';

export function constructPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[] = []): string {
  if (judge.mode === 'agent') return constructAgentPrompt(judge, inputContext, markers);
  // With paths as input there is no diff, so a `diff` rule gets the whole files, as a `file` rule does.
  if (judge.context === 'diff' && inputContext.type === 'diff') return constructDiffPrompt(judge, inputContext, markers);
  return constructOneShotPrompt(judge, inputContext, markers);
}

// Only the hunks: the model cannot see the rest of the files, so it cannot report old code.
function constructDiffPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[]): string {
  return `${outputContract()}
Judge Name: ${judge.name || judge.id}
Instructions to follow for your evaluation:
${judge.instructions}

${markersSection(markers)}Input Context to Review:
${diffSection(inputContext)}
Only the diff is shown, not the whole files. Report lines by their number in the new file, counted from the hunk headers (\`@@ -a,b +c,d @@\`: the first new line is c).
`;
}

function constructOneShotPrompt(judge: Judge, inputContext: EvaluationContext, markers: Marker[]): string {
  let contextSection = '';

  if (inputContext.type === 'diff') {
    contextSection = `${diffSection(inputContext)}
Only the change is under review: report only violations on lines the diff adds or changes (the "+" lines). The other lines are old code; do not report them, even where they break the rule.

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
    "message": "string (a detailed explanation of the issue and how to fix it)",
    "confidence": "number (how sure you are that this is a violation, in percent: a whole number from 0 to 100)"
  }
]

Give each issue a "confidence" on this scale:
- 90 to 100: a clear violation, the rule says so directly
- 70: likely, with one small assumption
- 50: could go either way
- 30 or less: probably fine, reported only to be safe

Report only violations of the rule. Never add an entry for code that follows the rule, not even as a note.
If nothing breaks the rule, return an empty array: []

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

// "  7| code": models report off-by-one lines without them.
export function numberLines(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width)}${LINE_NUMBER_SEPARATOR}${line}`).join('\n');
}

// The judge decides what each marker covers, and says so, so a covered violation is listed rather than hidden.
export function markersSection(markers: Marker[]): string {
  if (markers.length === 0) return '';
  const entries = markers.map((marker) => `- ${markerPlace(marker)} (rule-${marker.kind}): ${marker.reason}`);
  return `Markers: the team marked some places as known exceptions (rule-exception) or known debt (rule-debt) for this rule. Each marker is listed at its place, <file>:<line> of the marker comment, with its reason:
${entries.join('\n')}
Read each marker and decide what it covers: a line, a block, a function or a whole file, as its reason says. It may be about code above it, such as the function its docstring belongs to, or several lines below it.
List every violation, also the ones a marker accounts for. Give each violation a marker accounts for one more field: "covered_by": "<the marker's place, as listed above>". It is then left out of the report and shown with the marker that covered it.
Report every other violation as usual, without "covered_by", even right next to a marker: a marker covers only what its reason is about.

`;
}
