import path from 'node:path';
import { PnpmError } from '../error/index.ts';
import { packageManifestLogger } from '../core-loggers/index.ts';
import { globalWarn } from '../logger/index.ts';
import type {
  LockfileObject,
  ProjectSnapshot,
} from '../lockfile.types/index.ts';
import {
  getAllDependenciesFromManifest,
  getSpecFromPackageManifest,
  type PinnedVersion,
} from '../manifest-utils/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import {
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  type DependencyManifest,
  type PeerDependencyIssuesByProjects,
  type ProjectManifest,
  type ProjectId,
  type ProjectRootDir,
  type GlobalPkgDir,
  type LockFileDir,
  type ProjectRootDirRealPath,
  type WorkspaceDir,
} from '../types/index.ts';
import difference from 'ramda/src/difference';
import zipWith from 'ramda/src/zipWith';
import isSubdir from 'is-subdir';
import {
  getWantedDependencies,
  type WantedDependency,
} from './getWantedDependencies.ts';
import { depPathToRef } from './depPathToRef.ts';
import type { NodeId } from './nextNodeId.ts';
import {
  createNodeIdForLinkedLocalPkg,
  type UpdateMatchingFunction,
} from './resolveDependencies.ts';
import {
  type ImporterToResolveGeneric,
  type LinkedDependency,
  type ResolveDependenciesOptions,
  type ResolvedDirectDependency,
  type ResolvedPackage,
  resolveDependencyTree,
} from './resolveDependencyTree.ts';
import {
  type DependenciesByProjectId,
  resolvePeers,
  type GenericDependenciesGraphWithResolvedChildren,
  type GenericDependenciesGraphNodeWithResolvedChildren,
} from './resolvePeers.ts';
import { toResolveImporter } from './toResolveImporter.ts';
import { updateLockfile } from './updateLockfile.ts';
import { updateProjectManifest } from './updateProjectManifest.ts';
import { getCatalogSnapshots } from './getCatalogSnapshots.ts';
import type { ProjectOptions, HookOptions } from '../get-context/index.ts';

export type DependenciesGraph = GenericDependenciesGraphWithResolvedChildren;

export type DependenciesGraphNode =
  GenericDependenciesGraphNodeWithResolvedChildren & ResolvedPackage;

export {
  getWantedDependencies,
  type LinkedDependency,
  type ResolvedPackage,
  type PinnedVersion,
  type UpdateMatchingFunction,
  type WantedDependency,
};

type ProjectToLink = {
  binsDir: string;
  directNodeIdsByAlias: Map<string, NodeId>;
  id: ProjectId;
  linkedDependencies: LinkedDependency[];
  manifest?: ProjectManifest | undefined;
  modulesDir: string;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  topParents: Array<{
    name: string;
    version: string;
    alias?: string | undefined;
    linkedDir?: NodeId | undefined;
  }>;
};

export type ImporterToResolve = {
  id: ProjectId;
  modulesDir: string;
  removePackages?: string[] | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  wantedDependencies: Array<
    WantedDependency & {
      isNew?: boolean | undefined;
      updateDepth?: number | undefined;
      preserveNonSemverVersionSpec?: boolean | undefined;
    }
  >;
  peer?: boolean | undefined;
  pinnedVersion?: PinnedVersion | undefined;
  // binsDir: string;
  manifest?: ProjectManifest | undefined;
  originalManifest?: ProjectManifest | undefined;
  update?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;
  targetDependenciesField?: DependenciesField | undefined;
};

export type ResolveDependenciesResult = {
  dependenciesByProjectId: DependenciesByProjectId;
  dependenciesGraph: GenericDependenciesGraphWithResolvedChildren;
  outdatedDependencies: {
    [pkgId: string]: string;
  };
  linkedDependenciesByProjectId: Record<string, LinkedDependency[]>;
  newLockfile: LockfileObject;
  peerDependencyIssuesByProjects: PeerDependencyIssuesByProjects;
  waitTillAllFetchingsFinish: () => Promise<void>;
  wantedToBeSkippedPackageIds: Set<string>;
};

export async function resolveDependencies(
  importers: (ProjectOptions &
    HookOptions & {
      binsDir: string;
      updatePackageManifest?: boolean | undefined;
      wantedDependencies?: Array<WantedDependency> | undefined;
    })[],
  opts: ResolveDependenciesOptions & {
    defaultUpdateDepth: number;
    dedupePeerDependents?: boolean | undefined;
    dedupeDirectDeps?: boolean | undefined;
    dedupeInjectedDeps?: boolean | undefined;
    excludeLinksFromLockfile?: boolean | undefined;
    preserveWorkspaceProtocol: boolean;
    saveWorkspaceProtocol: 'rolling' | boolean;
    lockfileIncludeTarballUrl?: boolean | undefined;
    allowNonAppliedPatches?: boolean | undefined;
  }
): Promise<ResolveDependenciesResult> {
  const _toResolveImporter = toResolveImporter.bind(null, {
    defaultUpdateDepth: opts.defaultUpdateDepth,
    lockfileOnly: opts.dryRun,
    preferredVersions: opts.preferredVersions,
    virtualStoreDir: opts.virtualStoreDir,
    workspacePackages: opts.workspacePackages,
    noDependencySelectors: importers.every(
      ({
        wantedDependencies,
      }: ProjectOptions &
        HookOptions & {
          binsDir: string;
          updatePackageManifest?: boolean | undefined;
          wantedDependencies?: Array<WantedDependency> | undefined;
        }): boolean => {
        return wantedDependencies?.length === 0;
      }
    ),
  });

  const projectsToResolve = (
    await Promise.all(
      importers.map(
        async (
          project: ProjectOptions &
            HookOptions & {
              binsDir: string;
              updatePackageManifest?: boolean | undefined;
              wantedDependencies?: Array<WantedDependency> | undefined;
            }
        ): Promise<ImporterToResolveGeneric<{
          isNew?: boolean | undefined;
          updateDepth?: number | undefined;
        }> | null> => {
          return _toResolveImporter(project);
        }
      )
    )
  ).filter(Boolean);

  const {
    dependenciesTree,
    outdatedDependencies,
    resolvedImporters,
    resolvedPkgsById,
    wantedToBeSkippedPackageIds,
    appliedPatches,
    time,
    allPeerDepNames,
  } = await resolveDependencyTree(projectsToResolve, opts);

  opts.storeController.clearResolutionCache();

  // We only check whether patches were applied in cases when the whole lockfile was reanalyzed.
  if (
    opts.patchedDependencies &&
    (opts.forceFullResolution ||
      !Object.keys(opts.wantedLockfile.packages ?? {}).length) &&
    Object.keys(opts.wantedLockfile.importers ?? {}).length === importers.length
  ) {
    verifyPatches({
      patchedDependencies: Object.keys(opts.patchedDependencies),
      appliedPatches,
      allowNonAppliedPatches: opts.allowNonAppliedPatches,
    });
  }

  const projectsToLink = (
    await Promise.all<ProjectToLink | null>(
      projectsToResolve.map(
        async (
          project: ImporterToResolveGeneric<{
            updateDepth?: number | undefined;
          }>
        ): Promise<ProjectToLink | null> => {
          const resolvedImporter = resolvedImporters[project.id];

          if (typeof resolvedImporter === 'undefined') {
            return null;
          }

          const topParents: Array<{
            name: string;
            version: string;
            alias?: string | undefined;
            linkedDir?: NodeId | undefined;
          }> =
            typeof project.manifest === 'undefined'
              ? []
              : await getTopParents(
                  difference.default(
                    Object.keys(
                      getAllDependenciesFromManifest(project.manifest)
                    ),
                    resolvedImporter.directDependencies.map(
                      ({ alias }: ResolvedDirectDependency): string => {
                        return alias;
                      }
                    )
                  ),
                  project.modulesDir
                );

          for (const linkedDependency of resolvedImporter.linkedDependencies) {
            if (typeof linkedDependency.resolution.directory === 'undefined') {
              continue;
            }

            // The location of the external link may vary on different machines, so it is better not to include it in the lockfile.
            // As a workaround, we symlink to the root of node_modules, which is a symlink to the actual location of the external link.
            const target =
              opts.excludeLinksFromLockfile !== true ||
              isSubdir(opts.lockfileDir, linkedDependency.resolution.directory)
                ? linkedDependency.resolution.directory
                : path.join(project.modulesDir, linkedDependency.alias);

            const linkedDir = createNodeIdForLinkedLocalPkg(
              opts.lockfileDir,
              target
            );

            topParents.push({
              name: linkedDependency.alias,
              version: linkedDependency.version,
              linkedDir,
            });
          }

          return {
            binsDir: '',
            directNodeIdsByAlias: resolvedImporter.directNodeIdsByAlias,
            id: project.id,
            linkedDependencies: resolvedImporter.linkedDependencies,
            manifest: project.manifest,
            modulesDir: project.modulesDir,
            rootDir: project.rootDir,
            topParents,
          };
        }
      )
    )
  ).filter(Boolean);

  const {
    dependenciesGraph,
    dependenciesByProjectId,
    peerDependencyIssuesByProjects,
  } = await resolvePeers({
    allPeerDepNames,
    dependenciesTree,
    dedupePeerDependents: opts.dedupePeerDependents,
    dedupeInjectedDeps: opts.dedupeInjectedDeps,
    lockfileDir: opts.lockfileDir,
    projects: projectsToLink,
    virtualStoreDir: opts.virtualStoreDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    resolvePeersFromWorkspaceRoot: Boolean(opts.resolvePeersFromWorkspaceRoot),
    resolvedImporters,
    peersSuffixMaxLength: opts.peersSuffixMaxLength,
  });

  const linkedDependenciesByProjectId: Record<string, LinkedDependency[]> = {};
  (
    await Promise.all(
      projectsToResolve.map(
        async (
          project: ImporterToResolveGeneric<{
            updateDepth?: number | undefined;
          }>,
          index: number
        ): Promise<void> => {
          const resolvedImporter = resolvedImporters[project.id];

          if (typeof resolvedImporter === 'undefined') {
            return;
          }

          linkedDependenciesByProjectId[project.id] =
            resolvedImporter.linkedDependencies;

          let updatedManifest: ProjectManifest | undefined;

          let updatedOriginalManifest: ProjectManifest | undefined;

          if (project.updatePackageManifest === true) {
            [updatedManifest, updatedOriginalManifest] =
              await updateProjectManifest(project, {
                directDependencies: resolvedImporter.directDependencies,
                preserveWorkspaceProtocol: opts.preserveWorkspaceProtocol,
                saveWorkspaceProtocol: opts.saveWorkspaceProtocol,
              });
          } else {
            updatedManifest = project.manifest;

            updatedOriginalManifest = project.originalManifest;

            packageManifestLogger.debug({
              prefix: project.rootDir,
              updated: project.manifest,
            });
          }

          if (updatedManifest != null) {
            if (opts.autoInstallPeers === true) {
              if (updatedManifest.peerDependencies) {
                const allDeps = getAllDependenciesFromManifest(updatedManifest);

                for (const [peerName, peerRange] of Object.entries(
                  updatedManifest.peerDependencies
                )) {
                  if (typeof allDeps[peerName] !== 'undefined') {
                    continue;
                  }

                  updatedManifest.dependencies ??= {};

                  updatedManifest.dependencies[peerName] = peerRange;
                }
              }
            }

            const lockFileImporters = opts.wantedLockfile.importers ?? {};

            const projectSnapshot = lockFileImporters[project.id];

            if (typeof projectSnapshot !== 'undefined') {
              lockFileImporters[project.id] = addDirectDependenciesToLockfile(
                updatedManifest,
                projectSnapshot,
                resolvedImporter.linkedDependencies,
                resolvedImporter.directDependencies,
                opts.excludeLinksFromLockfile
              );
            }

            const importer = importers[index];

            if (typeof importer !== 'undefined') {
              importer.manifest =
                updatedOriginalManifest ??
                project.originalManifest ??
                project.manifest;
            }
          }

          for (const [alias, depPath] of dependenciesByProjectId[
            project.id
          ]?.entries() ?? []) {
            const projectSnapshot = opts.wantedLockfile.importers?.[project.id];

            const dm = project.manifest?.dependenciesMeta;

            if (
              typeof projectSnapshot !== 'undefined' &&
              typeof dm !== 'undefined'
            ) {
              projectSnapshot.dependenciesMeta = dm;
            }

            const depNode = dependenciesGraph[depPath];

            if (typeof depNode === 'undefined') {
              continue;
            }

            const ref = depPathToRef(depPath, {
              alias,
              realName: depNode.name,
              // resolution: depNode.resolution,
            });

            const deps = projectSnapshot?.dependencies;
            const devDeps = projectSnapshot?.devDependencies;
            const optionalDeps = projectSnapshot?.optionalDependencies;

            if (typeof deps?.[alias] !== 'undefined') {
              deps[alias] = ref;
            } else if (typeof devDeps?.[alias] !== 'undefined') {
              devDeps[alias] = ref;
            } else if (typeof optionalDeps?.[alias] !== 'undefined') {
              optionalDeps[alias] = ref;
            }
          }
        }
      )
    )
  ).filter(Boolean);

  if (opts.dedupeDirectDeps === true) {
    const rootDeps = dependenciesByProjectId['.'];

    if (rootDeps) {
      for (const [id, deps] of Object.entries(dependenciesByProjectId)) {
        if (id === '.') {
          continue;
        }

        for (const [alias, depPath] of deps.entries()) {
          if (depPath === rootDeps.get(alias)) {
            deps.delete(alias);
          }
        }
      }
    }
  }

  const newLockfile = updateLockfile({
    dependenciesGraph,
    lockfile: opts.wantedLockfile,
    prefix: opts.virtualStoreDir,
    registries: opts.registries,
    lockfileIncludeTarballUrl: opts.lockfileIncludeTarballUrl,
  });

  if (time) {
    newLockfile.time = {
      ...opts.wantedLockfile.time,
      ...time,
    };
  }

  newLockfile.catalogs = getCatalogSnapshots(
    Object.values(resolvedImporters).flatMap(
      ({
        directDependencies,
      }: {
        directDependencies: ResolvedDirectDependency[];
        directNodeIdsByAlias: Map<string, NodeId>;
        linkedDependencies: LinkedDependency[];
      }): ResolvedDirectDependency[] => {
        return directDependencies;
      }
    )
  );

  // waiting till package requests are finished
  async function waitTillAllFetchingsFinish(): Promise<void> {
    await Promise.all(
      Object.values(resolvedPkgsById).map(
        async ({ fetching }: ResolvedPackage): Promise<void> => {
          try {
            await fetching?.();
          } catch {}
        }
      )
    );
  }

  return {
    dependenciesByProjectId,
    dependenciesGraph,
    outdatedDependencies,
    linkedDependenciesByProjectId,
    newLockfile,
    peerDependencyIssuesByProjects,
    waitTillAllFetchingsFinish,
    wantedToBeSkippedPackageIds,
  };
}

function verifyPatches({
  patchedDependencies,
  appliedPatches,
  allowNonAppliedPatches,
}: {
  patchedDependencies: string[];
  appliedPatches: Set<string>;
  allowNonAppliedPatches?: boolean | undefined;
}): void {
  const nonAppliedPatches: string[] = patchedDependencies.filter(
    (patchKey: string): boolean => {
      return appliedPatches.has(patchKey) !== true;
    }
  );

  if (!nonAppliedPatches.length) return;

  const message = `The following patches were not applied: ${nonAppliedPatches.join(', ')}`;

  if (allowNonAppliedPatches === true) {
    globalWarn(message);

    return;
  }

  throw new PnpmError('PATCH_NOT_APPLIED', message, {
    hint: 'Either remove them from "patchedDependencies" or update them to match packages in your dependencies.',
  });
}

type RequiredDefined<T> = { [P in keyof T]-?: Exclude<T[P], undefined> };

function addDirectDependenciesToLockfile(
  newManifest: ProjectManifest,
  projectSnapshot: ProjectSnapshot,
  linkedPackages: Array<{ alias: string }>,
  directDependencies: ResolvedDirectDependency[],
  excludeLinksFromLockfile?: boolean
): ProjectSnapshot {
  const newProjectSnapshot: ProjectSnapshot &
    RequiredDefined<
      Pick<
        ProjectSnapshot,
        'dependencies' | 'devDependencies' | 'optionalDependencies'
      >
    > = {
    dependencies: {},
    devDependencies: {},
    optionalDependencies: {},
    specifiers: {},
  };

  if (typeof newManifest.publishConfig?.directory !== 'undefined') {
    newProjectSnapshot.publishDirectory = newManifest.publishConfig.directory;
  }

  for (const linkedPkg of linkedPackages) {
    newProjectSnapshot.specifiers[linkedPkg.alias] = getSpecFromPackageManifest(
      newManifest,
      linkedPkg.alias
    );
  }

  const directDependenciesByAlias: Record<string, ResolvedDirectDependency> =
    {};

  for (const directDependency of directDependencies) {
    directDependenciesByAlias[directDependency.alias] = directDependency;
  }

  const allDeps = Array.from(
    new Set(Object.keys(getAllDependenciesFromManifest(newManifest)))
  );

  for (const alias of allDeps) {
    const dep = directDependenciesByAlias[alias];

    if (typeof dep === 'undefined') {
      continue;
    }

    const spec = getSpecFromPackageManifest(newManifest, dep.alias);

    const specifier = projectSnapshot.specifiers[alias];

    if (
      excludeLinksFromLockfile !== true ||
      // dep.isLinkedDependency !== true ||
      (typeof spec !== 'undefined' && spec.startsWith('workspace:') === true)
    ) {
      const ref = depPathToRef(dep.pkgId, {
        alias: dep.alias,
        realName: dep.name,
        // resolution: dep.resolution,
      });

      const devDeps = newProjectSnapshot.devDependencies;
      const optionalDeps = newProjectSnapshot.optionalDependencies;
      const deps = newProjectSnapshot.dependencies;

      if (dep.dev === true) {
        if (typeof devDeps !== 'undefined') {
          devDeps[dep.alias] = ref;
        }
      } else if (dep.optional === true) {
        if (typeof optionalDeps !== 'undefined') {
          optionalDeps[dep.alias] = ref;
        }
      } else {
        if (typeof deps !== 'undefined') {
          deps[dep.alias] = ref;
        }
      }

      if (typeof spec !== 'undefined') {
        newProjectSnapshot.specifiers[dep.alias] = spec;
      }
    } else if (typeof specifier !== 'undefined') {
      newProjectSnapshot.specifiers[alias] = specifier;

      const pDeps = projectSnapshot.dependencies;
      const pDevDeps = projectSnapshot.devDependencies;
      const pOptionalDeps = projectSnapshot.optionalDependencies;

      if (typeof pDeps?.[alias] !== 'undefined') {
        newProjectSnapshot.dependencies[alias] = pDeps[alias];
      } else if (typeof pOptionalDeps?.[alias] !== 'undefined') {
        newProjectSnapshot.optionalDependencies[alias] = pOptionalDeps[alias];
      } else if (typeof pDevDeps?.[alias] !== 'undefined') {
        newProjectSnapshot.devDependencies[alias] = pDevDeps[alias];
      }
    }
  }

  alignDependencyTypes(newManifest, newProjectSnapshot);

  return newProjectSnapshot;
}

function alignDependencyTypes(
  manifest: ProjectManifest,
  projectSnapshot: ProjectSnapshot
): void {
  const depTypesOfAliases = getAliasToDependencyTypeMap(manifest);

  // Aligning the dependency types in pnpm-lock.yaml
  for (const depType of DEPENDENCIES_FIELDS) {
    if (projectSnapshot[depType] == null) continue;

    for (const [alias, ref] of Object.entries(projectSnapshot[depType] ?? {})) {
      const dt = depTypesOfAliases[alias];

      if (
        depType === dt ||
        typeof dt === 'undefined' ||
        typeof projectSnapshot[dt] === 'undefined'
      ) {
        continue;
      }

      projectSnapshot[dt][alias] = ref;

      delete projectSnapshot[depType][alias];
    }
  }
}

function getAliasToDependencyTypeMap(
  manifest: ProjectManifest
): Record<string, DependenciesField> {
  const depTypesOfAliases: Record<string, DependenciesField> = {};

  for (const depType of DEPENDENCIES_FIELDS) {
    if (manifest[depType] == null) {
      continue;
    }

    for (const alias of Object.keys(manifest[depType] ?? {})) {
      if (!depTypesOfAliases[alias]) {
        depTypesOfAliases[alias] = depType;
      }
    }
  }

  return depTypesOfAliases;
}

async function getTopParents(
  pkgAliases: string[],
  modulesDir: string
): Promise<DependencyManifest[]> {
  const pkgs = await Promise.all(
    pkgAliases
      .map((alias) => path.join(modulesDir, alias))
      .map(safeReadPackageJsonFromDir)
  );

  return zipWith
    .default(
      (
        manifest,
        alias
      ): {
        alias: string;
        name: string;
        version: string;
      } | null => {
        if (!manifest) return null;
        return {
          alias,
          name: manifest.name,
          version: manifest.version,
        };
      },
      pkgs,
      pkgAliases
    )
    .filter(Boolean);
}
