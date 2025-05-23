import type { MissingPeerIssuesByPeerName } from '../types/index.ts';
import { intersect } from 'semver-range-intersect';

export interface MergePeersResult {
  conflicts: string[];
  intersections: Record<string, string>;
}

export function mergePeers(
  missingPeers: MissingPeerIssuesByPeerName
): MergePeersResult {
  const conflicts: string[] = [];

  const intersections: Record<string, string> = {};

  for (const [peerName, ranges] of Object.entries(missingPeers)) {
    if (ranges.every(({ optional }) => optional)) {
      continue;
    }

    if (ranges.length === 1) {
      const r = ranges[0]?.wantedRange;

      if (typeof r !== 'undefined') {
        intersections[peerName] = r;
      }

      continue;
    }

    const intersection = safeIntersect(
      ranges.map(({ wantedRange }) => wantedRange)
    );

    if (intersection === null) {
      conflicts.push(peerName);
    } else {
      intersections[peerName] = intersection;
    }
  }

  return { conflicts, intersections };
}

export function safeIntersect(ranges: string[]): null | string {
  try {
    return intersect(...ranges);
  } catch {
    return null;
  }
}
