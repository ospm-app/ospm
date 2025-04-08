import type { LockfileObject } from '../lockfile.types/index.ts';
import type { DependenciesField, DepPath, ProjectId } from '../types/index.ts';
import { filterLockfileByImporters } from './filterLockfileByImporters.ts';

export function filterLockfile(
  lockfile: LockfileObject,
  opts: {
    include: { [dependenciesField in DependenciesField]: boolean };
    skipped: Set<DepPath>;
  }
): LockfileObject {
  return filterLockfileByImporters(
    lockfile,
    Object.keys(lockfile.importers ?? {}) as ProjectId[],
    {
      ...opts,
      failOnMissingDependencies: false,
    }
  );
}
