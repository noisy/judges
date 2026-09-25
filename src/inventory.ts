import colors from 'picocolors';
import { Marker } from './markers.js';

export interface MarkerGroup {
  ruleId: string;
  markers: Marker[];
}

// The inventory is one grep away: every marker, grouped by the rule it names.
export function groupByRule(markers: Marker[]): MarkerGroup[] {
  const groups = new Map<string, Marker[]>();
  for (const marker of markers) {
    groups.set(marker.ruleId, [...(groups.get(marker.ruleId) ?? []), marker]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ruleId, grouped]) => ({ ruleId, markers: grouped }));
}

export function formatInventory(groups: MarkerGroup[]): string {
  if (groups.length === 0) return 'No markers found.\n';
  return groups.map(formatGroup).join('\n');
}

function formatGroup(group: MarkerGroup): string {
  const header = `${colors.bold(group.ruleId)} (${group.markers.length})\n`;
  return header + group.markers.map(formatMarker).join('');
}

function formatMarker(marker: Marker): string {
  const location = `${marker.file}:${marker.markerLine}${marker.scope === 'file' ? ' (whole file)' : ''}`;
  const reason = marker.reason ?? colors.red('(no reason)');
  return `  ${marker.kind.padEnd(6)} ${colors.cyan(location)}  ${reason}\n`;
}
