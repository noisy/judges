export type MarkerKind = 'exception' | 'debt';

export interface Marker {
  kind: MarkerKind;
  ruleId: string;
  reason?: string;
  file: string;
  markerLine: number;
}

// `rule-ignore` and `rule-todo` are the old names; they are still read while teams move their markers over.
const KINDS: Record<string, MarkerKind> = { exception: 'exception', debt: 'debt', ignore: 'exception', todo: 'debt' };

// A marker starts its comment: only spaces and one opener may come before it. A line inside a docstring or a
// block comment has no opener of its own, so the opener is optional. Placeholders like `<rule-id>` are no id.
const MARKER_LINE =
  /^\s*(#|\/\/|--|;+|\/\*+|\*|<!--|"""|''')?\s*rule-(exception|debt|ignore|todo):\s*([A-Za-z0-9](?:[\w.-]*\w)?)(.*)$/;
const REASON_SEPARATOR = /^\s*--/;
const CLOSER = /\*\/|-->|"""|'''/;
const LEADING_STAR = /^\s*\*/;
// After one of these the comment goes on only over lines that start with the same opener.
const LINE_COMMENTS: Record<string, RegExp> = {
  '#': /^\s*#(.*)$/,
  '//': /^\s*\/\/(.*)$/,
  '--': /^\s*--(.*)$/,
  ';': /^\s*;+(.*)$/,
};

interface MarkerLine {
  kind: MarkerKind;
  ruleId: string;
  opener: string;
  rest: string; // the text after the rule id
}

interface CommentText {
  text: string;
  closed: boolean; // the comment ends on this line
}

// Markers are read line by line, without parsing the language. What a marker covers is up to the judge.
export function findMarkers(file: string, content: string): Marker[] {
  const lines = content.split('\n');
  const parsed = lines.map(parseMarkerLine);
  return parsed.flatMap((marker, index) => {
    if (!marker) return [];
    const reason = readReason(lines, parsed, index);
    return [{ kind: marker.kind, ruleId: marker.ruleId, reason, file, markerLine: index + 1 }];
  });
}

export function findMarkersInFiles(files: Array<{ path: string; content: string }>): Marker[] {
  return files.flatMap((file) => findMarkers(file.path, file.content));
}

// What a judge is told about, and so the only markers that can cover its findings: its own, with a reason.
export function accountedFor(markers: Marker[], ruleId: string): Marker[] {
  return markers.filter((marker) => marker.ruleId === ruleId && hasReason(marker));
}

export function hasReason(marker: Marker): boolean {
  return marker.reason !== undefined;
}

// The place a judge names in `covered_by`: the marker's own line.
export function markerPlace(marker: Marker): string {
  return `${marker.file}:${marker.markerLine}`;
}

// The marker a `covered_by` names, when it is one of the given markers; anything else names no marker.
export function namedMarker(markers: Marker[], place: unknown): Marker | undefined {
  if (typeof place !== 'string') return undefined;
  const match = place.trim().match(/^(.+):(\d+)$/);
  if (!match) return undefined;
  return markers.find((marker) => samePath(marker.file, match[1]) && marker.markerLine === Number(match[2]));
}

export function parseLineRange(line: string | number): { from: number; to: number } | null {
  const match = String(line).trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  return from <= to ? { from, to } : { from: to, to: from };
}

export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/^\.\//, '');
}

function parseMarkerLine(line: string): MarkerLine | null {
  const match = line.match(MARKER_LINE);
  if (!match) return null;
  const [, opener = '', keyword, ruleId, rest] = match;
  return { kind: KINDS[keyword], ruleId, opener, rest };
}

// The reason starts after ` -- ` on the marker line and goes on until the comment ends: at a line with no text,
// at the end of the comment or at the next marker. Its lines are joined into one.
function readReason(lines: string[], parsed: Array<MarkerLine | null>, index: number): string | undefined {
  const marker = parsed[index] as MarkerLine;
  const lineComment = LINE_COMMENTS[marker.opener.startsWith(';') ? ';' : marker.opener];
  const first = lineComment ? { text: marker.rest, closed: false } : cutAtCloser(marker.rest);
  if (!REASON_SEPARATOR.test(first.text)) return undefined;

  const pieces = [first.text.replace(REASON_SEPARATOR, '').trim()];
  if (pieces[0] === '') return undefined;
  for (let next = index + 1, open = !first.closed; open && next < lines.length && !parsed[next]; next++) {
    const piece = lineComment ? lineCommentText(lines[next], lineComment) : blockCommentText(lines[next]);
    const text = piece?.text.trim();
    if (!piece || !text) break;
    pieces.push(text);
    open = !piece.closed;
  }
  return pieces.join(' ');
}

function lineCommentText(line: string, comment: RegExp): CommentText | null {
  const match = line.match(comment);
  return match ? { text: match[1], closed: false } : null;
}

// In a block comment or docstring every line belongs to the comment until it closes; a ` * ` prefix is not text.
function blockCommentText(line: string): CommentText {
  const piece = cutAtCloser(line);
  return { ...piece, text: piece.text.replace(LEADING_STAR, '') };
}

// The text before a closer still belongs to the comment.
function cutAtCloser(text: string): CommentText {
  const closer = CLOSER.exec(text);
  return closer ? { text: text.slice(0, closer.index), closed: true } : { text, closed: false };
}
