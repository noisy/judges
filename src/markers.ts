export type MarkerKind = 'ignore' | 'todo';
export type MarkerScope = 'file' | { line: number };

export interface Marker {
  kind: MarkerKind;
  ruleId: string;
  reason?: string;
  file: string;
  markerLine: number;
  scope: MarkerScope;
}

// A marker is a whole-line comment: `# rule-ignore: <id> -- <reason>`, with any of #, //, --, /*, <!--, ;.
const MARKER_LINE = /^\s*(?:#|\/\/|--|\/\*+|<!--|;+)\s*rule-(ignore|todo):\s*([A-Za-z0-9][\w.-]*)(.*)$/;
const COMMENT_CLOSER = /\s*(?:\*\/|-->)\s*$/;
const REASON_SEPARATOR = /^\s*--\s?/;
const SHEBANG = /^#!/;

// File-level markers are the leading run of marker lines (after an optional shebang);
// every other marker covers the next line that is neither blank nor another marker.
export function findMarkers(file: string, content: string): Marker[] {
  const lines = content.split('\n');
  const parsed = lines.map(parseMarkerLine);
  const fileLevelEnd = leadingMarkerRunEnd(lines, parsed);

  return parsed.flatMap((marker, index) => {
    if (!marker) return [];
    const scope: MarkerScope = index < fileLevelEnd ? 'file' : { line: nextCodeLine(lines, parsed, index) };
    return [{ ...marker, file, markerLine: index + 1, scope }];
  });
}

// A range is covered only if every line in it is, so a finding that spans unmarked code is kept.
export function isCovered(markers: Marker[], ruleId: string, file: string, line: string | number): boolean {
  const relevant = markers.filter((marker) => marker.ruleId === ruleId && samePath(marker.file, file) && hasReason(marker));
  if (relevant.some((marker) => marker.scope === 'file')) return true;

  const range = parseLineRange(line);
  if (!range) return false;
  const coveredLines = new Set(relevant.map((marker) => (marker.scope as { line: number }).line));
  for (let n = range.from; n <= range.to; n++) {
    if (!coveredLines.has(n)) return false;
  }
  return true;
}

export function hasReason(marker: Marker): boolean {
  return marker.reason !== undefined;
}

export function parseLineRange(line: string | number): { from: number; to: number } | null {
  const match = String(line).trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  return from <= to ? { from, to } : { from: to, to: from };
}

type ParsedMarker = Pick<Marker, 'kind' | 'ruleId' | 'reason'>;

function parseMarkerLine(line: string): ParsedMarker | null {
  const match = line.match(MARKER_LINE);
  if (!match) return null;
  const [, kind, ruleId, rest] = match;
  return { kind: kind as MarkerKind, ruleId, reason: parseReason(rest) };
}

function parseReason(rest: string): string | undefined {
  const withoutCloser = rest.replace(COMMENT_CLOSER, '');
  if (!REASON_SEPARATOR.test(withoutCloser)) return undefined;
  const reason = withoutCloser.replace(REASON_SEPARATOR, '').trim();
  return reason === '' ? undefined : reason;
}

function leadingMarkerRunEnd(lines: string[], parsed: Array<ParsedMarker | null>): number {
  let index = lines.length > 0 && SHEBANG.test(lines[0]) ? 1 : 0;
  while (index < lines.length && parsed[index]) index++;
  return index;
}

function nextCodeLine(lines: string[], parsed: Array<ParsedMarker | null>, markerIndex: number): number {
  let index = markerIndex + 1;
  while (index < lines.length && (parsed[index] || lines[index].trim() === '')) index++;
  return index + 1;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/^\.\//, '');
}
