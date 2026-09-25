import picomatch from 'picomatch';
import { EvaluationContext } from './types.js';

export interface DiffSection {
  path: string;
  text: string;
}

const SECTION_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

// Narrows the context to the files a judge's scope covers; for diffs, also to their hunks.
export function scopeContext(context: EvaluationContext, scope: string[]): EvaluationContext {
  const inScope = picomatch(scope, { dot: true });
  const files = context.files.filter((file) => inScope(file.path));

  if (context.rawDiff === undefined) {
    return { ...context, files };
  }

  const rawDiff = splitDiffByFile(context.rawDiff)
    .filter((section) => inScope(section.path))
    .map((section) => section.text)
    .join('');
  return { ...context, rawDiff, files };
}

export function splitDiffByFile(rawDiff: string): DiffSection[] {
  const sections: DiffSection[] = [];
  for (const line of rawDiff.split(/(?<=\n)/)) {
    const header = line.trimEnd().match(SECTION_HEADER);
    if (header) {
      sections.push({ path: header[2], text: line });
    } else if (sections.length > 0) {
      sections[sections.length - 1].text += line;
    }
  }
  return sections;
}
