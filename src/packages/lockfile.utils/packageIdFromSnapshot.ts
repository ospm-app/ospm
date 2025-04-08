import type { DepPath, PkgId } from '../types/index.ts';
import type { PackageSnapshot } from '../lockfile.types/index.ts';
import * as dp from '../dependency-path/index.ts';

export function packageIdFromSnapshot(
  depPath: DepPath,
  pkgSnapshot: PackageSnapshot
): PkgId {
  if (typeof pkgSnapshot.id === 'string') {
    return pkgSnapshot.id as PkgId;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return dp.tryGetPackageId(depPath) ?? depPath;
}
