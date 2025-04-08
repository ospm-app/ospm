import { promises as fs } from 'node:fs';
import path from 'node:path';
import { removalLogger, statsLogger } from '../core-loggers/index.ts';
import {
  filterLockfile,
  filterLockfileByImporters,
} from '../lockfile.filtering/index.ts';
import type {
  LockfileObject,
  PackageSnapshots,
  ProjectSnapshot,
  ResolvedDependencies,
} from '../lockfile.types/index.ts';
import { packageIdFromSnapshot } from '../lockfile.utils/index.ts';
import { logger } from '../logger/index.ts';
import { readModulesDir } from '../read-modules-dir/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import {
  type DepPath,
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  type HoistedDependencies,
  type ProjectId,
  type ProjectRootDir,
  type GlobalPkgDir,
  type ProjectRootDirRealPath,
  type WorkspaceDir,
  type LockFileDir,
  type ModulesDir,
} from '../types/index.ts';
import { depPathToFilename } from '../dependency-path/index.ts';
import rimraf from '@zkochan/rimraf';
import difference from 'ramda/src/difference';
import equals from 'ramda/src/equals';
import mergeAll from 'ramda/src/mergeAll';
import pickAll from 'ramda/src/pickAll';
import {
  removeDirectDependency,
  removeIfEmpty,
} from './removeDirectDependency.ts';

export async function prune<IP>(
  importers: Array<{
    binsDir: string;
    id: ProjectId;
    modulesDir: ModulesDir;
    pruneDirectDependencies?: boolean | undefined;
    removePackages?: string[] | undefined;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  }>,
  opts: {
    dedupeDirectDeps?: boolean | undefined;
    dryRun?: boolean | undefined;
    include: { [dependenciesField in DependenciesField]: boolean };
    hoistedDependencies: HoistedDependencies;
    hoistedModulesDir?: ModulesDir | undefined;
    publicHoistedModulesDir?: ModulesDir | undefined;
    wantedLockfile: LockfileObject;
    currentLockfile: LockfileObject;
    pruneStore?: boolean | undefined;
    pruneVirtualStore?: boolean | undefined;
    skipped: Set<DepPath>;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    lockfileDir: string;
    storeController: StoreController<PackageResponse, PackageResponse, IP>;
  }
): Promise<Set<string>> {
  const wantedLockfile = filterLockfile(opts.wantedLockfile, {
    include: opts.include,
    skipped: opts.skipped,
  });

  const rootImporter =
    wantedLockfile.importers?.['.' as ProjectId] ?? ({} as ProjectSnapshot);

  const wantedRootPkgs = mergeDependencies(rootImporter);

  await Promise.all(
    importers.map(
      async ({
        binsDir,
        id,
        modulesDir,
        pruneDirectDependencies,
        removePackages,
        rootDir,
      }: {
        binsDir: string;
        id: ProjectId;
        modulesDir: ModulesDir;
        pruneDirectDependencies?: boolean | undefined;
        removePackages?: string[] | undefined;
        rootDir:
          | ProjectRootDir
          | ProjectRootDirRealPath
          | GlobalPkgDir
          | WorkspaceDir
          | LockFileDir;
      }): Promise<void> => {
        const currentImporter =
          opts.currentLockfile.importers?.[id] || ({} as ProjectSnapshot);

        const currentPkgs = Object.entries(mergeDependencies(currentImporter));

        const wantedPkgs = mergeDependencies(wantedLockfile.importers?.[id]);

        const allCurrentPackages = new Set(
          pruneDirectDependencies === true ||
            typeof removePackages?.length === 'number'
            ? ((await readModulesDir(modulesDir)) ?? [])
            : []
        );

        const depsToRemove = new Set(
          (removePackages ?? []).filter((removePackage: string): boolean => {
            return allCurrentPackages.has(removePackage);
          })
        );

        for (const [depName, depVersion] of currentPkgs) {
          if (
            typeof wantedPkgs[depName] === 'undefined' ||
            wantedPkgs[depName] !== depVersion ||
            (opts.dedupeDirectDeps === true &&
              id !== '.' &&
              wantedPkgs[depName] === wantedRootPkgs[depName])
          ) {
            depsToRemove.add(depName);
          }
        }

        if (pruneDirectDependencies === true) {
          const publiclyHoistedDeps = getPubliclyHoistedDependencies(
            opts.hoistedDependencies
          );

          if (allCurrentPackages.size > 0) {
            for (const currentPackage of allCurrentPackages) {
              if (
                typeof wantedPkgs[currentPackage] === 'undefined' &&
                !publiclyHoistedDeps.has(currentPackage)
              ) {
                depsToRemove.add(currentPackage);
              }
            }
          }
        }

        const removedFromScopes = new Set<string>();

        await Promise.all(
          Array.from(depsToRemove).map(
            async (depName: string): Promise<void> => {
              const scope = getScopeFromPackageName(depName);

              if (typeof scope === 'string' && scope !== '') {
                removedFromScopes.add(scope);
              }

              return removeDirectDependency(
                {
                  dependenciesField:
                    typeof currentImporter.devDependencies?.[depName] !==
                    'undefined'
                      ? 'devDependencies'
                      : typeof currentImporter.optionalDependencies?.[
                            depName
                          ] !== 'undefined'
                        ? 'optionalDependencies'
                        : typeof currentImporter.dependencies?.[depName] !==
                            'undefined'
                          ? 'dependencies'
                          : undefined,
                  name: depName,
                },
                {
                  binsDir,
                  dryRun: opts.dryRun,
                  modulesDir,
                  rootDir,
                }
              );
            }
          )
        );

        await Promise.all(
          Array.from(removedFromScopes).map((scope) =>
            removeIfEmpty(path.join(modulesDir, scope))
          )
        );

        try {
          await removeIfEmpty(modulesDir);
        } catch {
          // On some server setups we might not have permission to remove the node_modules directory.
          // That's fine, just proceed.
        }
      }
    )
  );

  const selectedImporterIds = importers.map((importer) => importer.id).sort();
  // In case installation is done on a subset of importers,
  // we may only prune dependencies that are used only by that subset of importers.
  // Otherwise, we would break the node_modules.
  const currentPkgIdsByDepPaths = equals.default(
    selectedImporterIds,
    Object.keys(opts.wantedLockfile.importers ?? {})
  )
    ? getPkgsDepPaths(opts.currentLockfile.packages ?? {}, opts.skipped)
    : getPkgsDepPathsOwnedOnlyByImporters(
        selectedImporterIds,
        opts.currentLockfile,
        opts.include,
        opts.skipped
      );

  const wantedPkgIdsByDepPaths = getPkgsDepPaths(
    wantedLockfile.packages ?? {},
    opts.skipped
  );

  const orphanDepPaths = (
    Object.keys(currentPkgIdsByDepPaths) as DepPath[]
  ).filter((path: DepPath): boolean => {
    return typeof wantedPkgIdsByDepPaths[path] === 'undefined';
  });

  const orphanPkgIds = new Set(
    orphanDepPaths.map((path) => currentPkgIdsByDepPaths[path])
  );

  statsLogger.debug({
    prefix: opts.lockfileDir,
    removed: orphanPkgIds.size,
  });

  if (opts.dryRun !== true) {
    if (
      orphanDepPaths.length > 0 &&
      opts.currentLockfile.packages != null &&
      (opts.hoistedModulesDir != null || opts.publicHoistedModulesDir != null)
    ) {
      const prefix = path.join(opts.virtualStoreDir, '../..');

      await Promise.all(
        orphanDepPaths.map(async (orphanDepPath: DepPath): Promise<void> => {
          if (opts.hoistedDependencies[orphanDepPath]) {
            await Promise.all(
              Object.entries(opts.hoistedDependencies[orphanDepPath]).map(
                ([alias, hoistType]: [
                  string,
                  'public' | 'private',
                ]): Promise<void> => {
                  const modulesDir =
                    hoistType === 'public'
                      ? opts.publicHoistedModulesDir
                      : opts.hoistedModulesDir;

                  if (typeof modulesDir === 'undefined' || modulesDir === '') {
                    return Promise.resolve();
                  }

                  return removeDirectDependency(
                    {
                      name: alias,
                    },
                    {
                      binsDir: path.join(modulesDir, '.bin'),
                      modulesDir,
                      muteLogs: true,
                      rootDir: prefix as ProjectRootDir,
                    }
                  );
                }
              )
            );
          }

          delete opts.hoistedDependencies[orphanDepPath];
        })
      );
    }

    if (opts.pruneVirtualStore !== false) {
      const _tryRemovePkg = tryRemovePkg.bind(
        null,
        opts.lockfileDir,
        opts.virtualStoreDir
      );

      await Promise.all(
        orphanDepPaths
          .map((orphanDepPath: DepPath): string => {
            return depPathToFilename(
              orphanDepPath,
              opts.virtualStoreDirMaxLength
            );
          })
          .map(async (orphanDepPath: string): Promise<void> => {
            return _tryRemovePkg(orphanDepPath);
          })
      );

      const neededPkgs = new Set<string>(['node_modules']);

      for (const depPath of Object.keys(opts.wantedLockfile.packages ?? {})) {
        if (opts.skipped.has(depPath as DepPath)) {
          continue;
        }

        neededPkgs.add(
          depPathToFilename(depPath, opts.virtualStoreDirMaxLength)
        );
      }

      const availablePkgs = await readVirtualStoreDir(
        opts.virtualStoreDir,
        opts.lockfileDir
      );

      await Promise.all(
        availablePkgs
          .filter((availablePkg: string): boolean => {
            return neededPkgs.has(availablePkg) !== true;
          })
          .map(async (orphanDepPath: string): Promise<void> => {
            return _tryRemovePkg(orphanDepPath);
          })
      );
    }
  }

  return new Set(orphanDepPaths);
}

function getScopeFromPackageName(pkgName: string): string | undefined {
  if (pkgName.startsWith('@')) {
    return pkgName.substring(0, pkgName.indexOf('/'));
  }

  return undefined;
}

async function readVirtualStoreDir(
  virtualStoreDir: string,
  lockfileDir: string
): Promise<string[]> {
  try {
    return await fs.readdir(virtualStoreDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      logger.warn({
        error: err,
        message: `Failed to read virtualStoreDir at "${virtualStoreDir}"`,
        prefix: lockfileDir,
      });
    }

    return [];
  }
}

async function tryRemovePkg(
  lockfileDir: string,
  virtualStoreDir: string,
  pkgDir: string
): Promise<void> {
  const pathToRemove = path.join(virtualStoreDir, pkgDir);

  removalLogger.debug(pathToRemove);

  try {
    await rimraf(pathToRemove);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    logger.warn({
      error: err,
      message: `Failed to remove "${pathToRemove}"`,
      prefix: lockfileDir,
    });
  }
}

function mergeDependencies(projectSnapshot: ProjectSnapshot | undefined): {
  [depName: string]: string;
} {
  return mergeAll.default<ResolvedDependencies>(
    DEPENDENCIES_FIELDS.map(
      (depType: DependenciesField): ResolvedDependencies => {
        return projectSnapshot?.[depType] ?? {};
      }
    )
  );
}

function getPkgsDepPaths(
  packages: PackageSnapshots,
  skipped: Set<string>
): Record<DepPath, string> {
  const acc: Record<DepPath, string> = {};

  for (const [depPath, pkg] of Object.entries(packages)) {
    if (skipped.has(depPath)) {
      return acc;
    }

    acc[depPath as DepPath] = packageIdFromSnapshot(depPath as DepPath, pkg);
  }

  return acc;
}

function getPkgsDepPathsOwnedOnlyByImporters(
  importerIds: ProjectId[],
  lockfile: LockfileObject,
  include: { [dependenciesField in DependenciesField]: boolean },
  skipped: Set<DepPath>
): Record<string, string> {
  const selected = filterLockfileByImporters(lockfile, importerIds, {
    failOnMissingDependencies: false,
    include,
    skipped,
  });

  const other = filterLockfileByImporters(
    lockfile,
    difference.default(
      Object.keys(lockfile.importers ?? {}) as ProjectId[],
      importerIds
    ),
    {
      failOnMissingDependencies: false,
      include,
      skipped,
    }
  );

  const packagesOfSelectedOnly: PackageSnapshots = pickAll.default<
    PackageSnapshots | undefined,
    PackageSnapshots
  >(
    difference.default(
      Object.keys(selected.packages ?? {}),
      Object.keys(other.packages ?? {})
    ),
    selected.packages
  );

  return getPkgsDepPaths(packagesOfSelectedOnly, skipped);
}

function getPubliclyHoistedDependencies(
  hoistedDependencies: HoistedDependencies
): Set<string> {
  const publiclyHoistedDeps = new Set<string>();

  for (const hoistedAliases of Object.values(hoistedDependencies)) {
    for (const [alias, hoistType] of Object.entries(hoistedAliases)) {
      if (hoistType === 'public') {
        publiclyHoistedDeps.add(alias);
      }
    }
  }

  return publiclyHoistedDeps;
}
