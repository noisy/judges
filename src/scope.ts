import picomatch from 'picomatch';
import { EvaluationContext } from './types.js';

export interface DiffSection {
  path: string;
  text: string;
}

const SECTION_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const NEGATION_PREFIX = '!';

// Narrows the context to the files a judge's scope covers; for diffs, also to their hunks.
export function scopeContext(context: EvaluationContext, scope: string[]): EvaluationContext {
  const inScope = scopeMatcher(scope);
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

// A path is in scope when it matches a positive glob and no negated one. picomatch alone reads
// a negated glob in a list as "everything else", which would let excluded paths back in.
function scopeMatcher(scope: string[]): (path: string) => boolean {
  const positive = scope.filter((glob) => !glob.startsWith(NEGATION_PREFIX));
  const negated = scope
    .filter((glob) => glob.startsWith(NEGATION_PREFIX))
    .map((glob) => glob.slice(NEGATION_PREFIX.length));
  if (positive.length === 0) return () => false;
  const included = picomatch(positive, { dot: true });
  const excluded = negated.length > 0 ? picomatch(negated, { dot: true }) : () => false;
  return (path) => included(path) && !excluded(path);
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
