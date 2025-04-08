import semver from 'semver';

export function isIntersectingRange(
  range1: string | undefined,
  range2: string
): boolean {
  return (
    typeof range1 === 'undefined' ||
    range2 === range1 ||
    (semver.validRange(range2) != null &&
      semver.validRange(range1) != null &&
      semver.intersects(range2, range1))
  );
}
