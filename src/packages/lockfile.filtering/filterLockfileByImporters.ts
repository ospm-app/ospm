import { WANTED_LOCKFILE } from '../constants/index.ts';
import { LockfileMissingDependencyError } from '../error/index.ts';
import type {
  LockfileObject,
  PackageSnapshots,
} from '../lockfile.types/index.ts';
import {
  lockfileWalker,
  type LockfileWalkerStep,
} from '../lockfile.walker/index.ts';
import { logger } from '../logger/index.ts';
import type { DependenciesField, DepPath, ProjectId } from '../types/index.ts';
import { filterImporter } from './filterImporter.ts';

const lockfileLogger = logger('lockfile');

export function filterLockfileByImporters(
  lockfile: LockfileObject,
  importerIds: ProjectId[],
  opts: {
    include: { [dependenciesField in DependenciesField]: boolean };
    skipped: Set<DepPath>;
    failOnMissingDependencies: boolean;
  }
): LockfileObject {
  const packages = {} as PackageSnapshots;

  if (typeof lockfile.packages !== 'undefined') {
    pkgAllDeps(
      lockfileWalker(lockfile, importerIds, {
        include: opts.include,
        skipped: opts.skipped,
      }).step,
      packages,
      {
        failOnMissingDependencies: opts.failOnMissingDependencies,
      }
    );
  }

  const importers = { ...lockfile.importers };

  for (const importerId of importerIds) {
    const importer = lockfile.importers?.[importerId];

    if (typeof importer !== 'undefined') {
      importers[importerId] = filterImporter(importer, opts.include);
    }
  }

  return {
    ...lockfile,
    importers,
    packages,
  };
}

function pkgAllDeps(
  step: LockfileWalkerStep,
  pickedPackages: PackageSnapshots,
  opts: {
    failOnMissingDependencies: boolean;
  }
): void {
  for (const { pkgSnapshot, depPath, next } of step.dependencies) {
    pickedPackages[depPath] = pkgSnapshot;
    pkgAllDeps(next(), pickedPackages, opts);
  }

  for (const depPath of step.missing) {
    if (opts.failOnMissingDependencies) {
      throw new LockfileMissingDependencyError(depPath);
    }

    lockfileLogger.debug(`No entry for "${depPath}" in ${WANTED_LOCKFILE}`);
  }
}
