import semver from 'semver';

export function isSubRange(
  superRange: string | undefined,
  subRange: string
): boolean {
  return (
    typeof superRange === 'undefined' ||
    subRange === superRange ||
    (semver.validRange(subRange) != null &&
      semver.validRange(superRange) != null &&
      semver.subset(subRange, superRange))
  );
}
