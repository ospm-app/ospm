import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { buildModules } from '../build-modules/index.ts';
import { createAllowBuildFunction } from '@pnpm/builder.policy';
import { calcDepState, type DepsStateCache } from '../calc-dep-state/index.ts';
import { LAYOUT_VERSION, WANTED_LOCKFILE } from '../constants/index.ts';
import {
  ignoredScriptsLogger,
  packageManifestLogger,
  progressLogger,
  stageLogger,
  statsLogger,
  summaryLogger,
} from '../core-loggers/index.ts';
import {
  filterLockfileByEngine,
  filterLockfileByImportersAndEngine,
} from '../lockfile.filtering/index.ts';
import { hoist, type HoistedWorkspaceProject } from '../hoist/index.ts';
import {
  runLifecycleHooksConcurrently,
  makeNodeRequireOption,
} from '../lifecycle/index.ts';
import { linkBins, linkBinsOfPackages } from '../link-bins/index.ts';
import {
  getLockfileImporterId,
  readCurrentLockfile,
  readWantedLockfile,
  writeLockfiles,
  writeCurrentLockfile,
} from '../lockfile.fs/index.ts';
import { writePnpFile } from '../lockfile-to-pnp/index.ts';
import {
  extendProjectsWithTargetDirs,
  nameVerFromPkgSnapshot,
} from '../lockfile.utils/index.ts';
import { type LogBase, logger, streamParser } from '../logger/index.ts';
import { prune } from '../modules-cleaner/index.ts';
import {
  type IncludedDependencies,
  type Modules,
  writeModulesManifest,
} from '../modules-yaml/index.ts';
import type { HoistingLimits } from '../real-hoist/index.ts';
import { readPackageJsonFromDir } from '../read-package-json/index.ts';
import {
  readProjectManifestOnly,
  safeReadProjectManifestOnly,
} from '../read-project-manifest/index.ts';
import type {
  StoreController,
  PackageResponse,
} from '../store-controller-types/index.ts';
import { symlinkDependency } from '../symlink-dependency/index.ts';
import {
  type DepPath,
  type DependencyManifest,
  type HoistedDependencies,
  type ProjectId,
  type ProjectManifest,
  type Registries,
  DEPENDENCIES_FIELDS,
  type SupportedArchitectures,
  type ProjectRootDir,
  type GlobalPkgDir,
  type ProjectRootDirRealPath,
  type LockFileDir,
  type WorkspaceDir,
  type ModulesDir,
} from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import { symlinkAllModules } from '../worker/index.ts';
import pLimit from 'p-limit';
import pathAbsolute from 'path-absolute';
import equals from 'ramda/src/equals';
import isEmpty from 'ramda/src/isEmpty';
import omit from 'ramda/src/omit';
import pick from 'ramda/src/pick';
import pickBy from 'ramda/src/pickBy';
import props from 'ramda/src/props';
import union from 'ramda/src/union';
import realpathMissing from 'realpath-missing';
import { linkHoistedModules } from './linkHoistedModules.ts';
import {
  type DirectDependenciesByImporterId,
  type DependenciesGraph,
  type DependenciesGraphNode,
  lockfileToDepGraph,
  type LockfileToDepGraphOptions,
} from '../deps.graph-builder/index.ts';
import {
  lockfileToHoistedDepGraph,
  type LockfileToHoistedDepGraphOptions,
} from './lockfileToHoistedDepGraph.ts';
import {
  linkDirectDeps,
  type LinkedDirectDep,
} from '../pkg-manager.direct-dep-linker/index.ts';
import type { PackageFilesResponse } from '../cafs-types/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { ProjectOptions, HookOptions } from '../get-context/index.ts';
import type { PatchGroupRecord } from '../patching.types/index.ts';

export type { HoistingLimits };

export type ReporterFunction = (logObj: LogBase) => void;

export type Project = {
  binsDir: string;
  buildIndex: number;
  manifest: ProjectManifest;
  modulesDir: ModulesDir;
  id: ProjectId;
  pruneDirectDependencies?: boolean | undefined;
  rootDir: ProjectRootDir | ProjectRootDirRealPath | GlobalPkgDir;
};

export type HeadlessOptions = {
  neverBuiltDependencies?: string[] | undefined;
  ignoredBuiltDependencies?: string[] | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  onlyBuiltDependenciesFile?: string | undefined;
  autoInstallPeers: boolean;
  childConcurrency?: number | undefined;
  currentLockfile?: LockfileObject | undefined;
  currentEngine: {
    nodeVersion?: string | undefined;
    pnpmVersion?: string | undefined;
  };
  dedupeDirectDeps?: boolean | undefined;
  enablePnp?: boolean | undefined;
  engineStrict: boolean;
  excludeLinksFromLockfile?: boolean | undefined;
  extraBinPaths?: string[] | undefined;
  extraEnv?: Record<string, string> | undefined;
  extraNodePaths?: string[] | undefined;
  preferSymlinkedExecutables?: boolean | undefined;
  hoistingLimits: HoistingLimits;
  externalDependencies?: Set<string> | undefined;
  ignoreDepScripts: boolean;
  ignoreScripts: boolean;
  ignorePackageManifest?: boolean | undefined;
  include: IncludedDependencies;
  selectedProjectDirs: string[];
  allProjects: Record<
    string,
    ProjectOptions &
      HookOptions & {
        binsDir: string;
      }
  >;
  prunedAt?: string | undefined;
  hoistedDependencies: HoistedDependencies;
  hoistPattern?: string[] | undefined;
  publicHoistPattern?: string[] | undefined;
  currentHoistedLocations?: Record<string, string[]> | undefined;
  lockfileDir: LockFileDir;
  modulesDir: ModulesDir;
  virtualStoreDir?: string | undefined;
  virtualStoreDirMaxLength: number;
  patchedDependencies?: PatchGroupRecord | undefined;
  scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
  scriptShell?: string | undefined;
  shellEmulator?: boolean | undefined;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      importMethod?: string | undefined;
      isBuilt: boolean;
    }
  >;
  sideEffectsCacheRead: boolean;
  sideEffectsCacheWrite: boolean;
  symlink?: boolean | undefined;
  disableRelinkLocalDirDeps?: boolean | undefined;
  force: boolean;
  storeDir: string;
  rawConfig: object;
  unsafePerm: boolean;
  userAgent: string;
  registries: Registries;
  reporter?: ReporterFunction | undefined;
  packageManager: {
    name: string;
    version: string;
  };
  pruneStore: boolean;
  pruneVirtualStore?: boolean | undefined;
  wantedLockfile?: LockfileObject | undefined;
  ownLifecycleHooksStdio: 'inherit' | 'pipe';
  pendingBuilds: string[];
  resolveSymlinksInInjectedDirs?: boolean | undefined;
  skipped?: Set<DepPath> | undefined;
  enableModulesDir?: boolean | undefined;
  nodeLinker?: 'isolated' | 'hoisted' | 'pnp' | undefined;
  useGitBranchLockfile?: boolean | undefined;
  useLockfile?: boolean | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
  hoistWorkspacePackages?: boolean | undefined;
  modulesFile?: Modules | null | undefined;
};

export type InstallationResultStats = {
  added: number;
  removed: number;
  linkedToRoot: number;
};

export type InstallationResult = {
  stats: InstallationResultStats;
  ignoredBuilds: string[] | undefined;
};

export async function headlessInstall(
  opts: HeadlessOptions
): Promise<InstallationResult> {
  const reporter = opts.reporter;

  if (reporter != null && typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const lockfileDir = opts.lockfileDir;

  const wantedLockfile =
    opts.wantedLockfile ??
    (await readWantedLockfile(lockfileDir, {
      ignoreIncompatible: false,
      useGitBranchLockfile: opts.useGitBranchLockfile,
      // mergeGitBranchLockfiles is intentionally not supported in headless
      mergeGitBranchLockfiles: false,
    }));

  if (wantedLockfile == null) {
    throw new Error(`Headless installation requires a ${WANTED_LOCKFILE} file`);
  }

  const depsStateCache: DepsStateCache = {};

  const relativeModulesDir = opts.modulesDir;

  const rootModulesDir = (await realpathMissing(
    path.join(lockfileDir, relativeModulesDir)
  )) as ModulesDir;

  const virtualStoreDir = pathAbsolute(
    opts.virtualStoreDir ?? path.join(relativeModulesDir, '.pnpm'),
    lockfileDir
  );

  const currentLockfile =
    opts.currentLockfile ??
    (await readCurrentLockfile(virtualStoreDir, { ignoreIncompatible: false }));

  const hoistedModulesDir = path.join(
    virtualStoreDir,
    'node_modules'
  ) as ModulesDir;

  const publicHoistedModulesDir = rootModulesDir;

  const selectedProjects = Object.values(
    pick.default(opts.selectedProjectDirs, opts.allProjects)
  );

  const scriptsOpts = {
    optional: false,
    extraBinPaths: opts.extraBinPaths,
    extraNodePaths: opts.extraNodePaths,
    preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
    extraEnv: opts.extraEnv,
    rawConfig: opts.rawConfig,
    resolveSymlinksInInjectedDirs: opts.resolveSymlinksInInjectedDirs,
    scriptsPrependNodePath: opts.scriptsPrependNodePath,
    scriptShell: opts.scriptShell,
    shellEmulator: opts.shellEmulator,
    stdio: opts.ownLifecycleHooksStdio,
    storeController: opts.storeController,
    unsafePerm: opts.unsafePerm || false,
  };

  const skipped = opts.skipped || new Set<DepPath>();

  const filterOpts = {
    include: opts.include,
    registries: opts.registries,
    skipped,
    currentEngine: opts.currentEngine,
    engineStrict: opts.engineStrict,
    failOnMissingDependencies: true,
    includeIncompatiblePackages: opts.force,
    lockfileDir,
    supportedArchitectures: opts.supportedArchitectures,
  };

  let removed = 0;

  if (opts.nodeLinker !== 'hoisted') {
    if (currentLockfile != null && opts.ignorePackageManifest !== true) {
      const removedDepPaths = await prune(selectedProjects, {
        currentLockfile,
        dedupeDirectDeps: opts.dedupeDirectDeps,
        dryRun: false,
        hoistedDependencies: opts.hoistedDependencies,
        hoistedModulesDir:
          opts.hoistPattern == null ? undefined : hoistedModulesDir,
        include: opts.include,
        lockfileDir,
        pruneStore: opts.pruneStore,
        pruneVirtualStore: opts.pruneVirtualStore,
        publicHoistedModulesDir:
          typeof opts.publicHoistPattern === 'undefined'
            ? undefined
            : publicHoistedModulesDir,
        skipped,
        storeController: opts.storeController,
        virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
        wantedLockfile: (
          await filterLockfileByEngine(wantedLockfile, filterOpts)
        ).lockfile,
      });

      removed = removedDepPaths.size;
    } else {
      statsLogger.debug({
        prefix: lockfileDir,
        removed: 0,
      });
    }
  }

  stageLogger.debug({
    prefix: lockfileDir,
    stage: 'importing_started',
  });

  const initialImporterIds =
    opts.ignorePackageManifest === true || opts.nodeLinker === 'hoisted'
      ? (Object.keys(wantedLockfile.importers ?? {}) as ProjectId[])
      : selectedProjects.map(
          ({
            id,
          }: ProjectOptions &
            HookOptions & {
              binsDir: string;
            }): ProjectId => {
            return id;
          }
        );

  const { lockfile: filteredLockfile, selectedImporterIds: importerIds } =
    await filterLockfileByImportersAndEngine(
      wantedLockfile,
      initialImporterIds,
      filterOpts
    );

  if (opts.excludeLinksFromLockfile === true) {
    for (const { id, manifest, rootDir } of selectedProjects) {
      if (filteredLockfile.importers?.[id]) {
        for (const depType of DEPENDENCIES_FIELDS) {
          filteredLockfile.importers[id][depType] = {
            ...filteredLockfile.importers[id][depType],
            ...Object.entries(manifest?.[depType] ?? {})
              .filter(([_, spec]: [string, string]): boolean => {
                return spec.startsWith('link:');
              })
              .reduce(
                (
                  acc: Record<string, string>,
                  [depName, spec]: [string, string]
                ): Record<string, string> => {
                  const linkPath = spec.substring(5);
                  acc[depName] = path.isAbsolute(linkPath)
                    ? `link:${path.relative(rootDir, spec.substring(5))}`
                    : spec;
                  return acc;
                },
                {}
              ),
          };
        }
      }
    }
  }

  // Update selectedProjects to add missing projects. importerIds will have the updated ids, found from deeply linked workspace projects
  const initialImporterIdSet = new Set(initialImporterIds);

  const missingIds = importerIds.filter(
    (importerId: string | ProjectId): boolean => {
      return !initialImporterIdSet.has(importerId);
    }
  );

  if (missingIds.length > 0) {
    for (const project of Object.values(opts.allProjects)) {
      if (missingIds.includes(project.id) === true) {
        selectedProjects.push(project);
      }
    }
  }

  // const lockfileToDepGraphOpts: LockfileToDepGraphOptions = {
  //   ...opts,
  //   importerIds,
  //   lockfileDir,
  //   skipped,
  //   virtualStoreDir,
  //   nodeVersion: opts.currentEngine.nodeVersion,
  //   pnpmVersion: opts.currentEngine.pnpmVersion,
  //   supportedArchitectures: opts.supportedArchitectures,
  // };

  function warn(message: string): void {
    logger.info({
      message,
      prefix: lockfileDir,
    });
  }

  let newHoistedDependencies: HoistedDependencies | undefined;

  let linkedToRoot = 0;

  if (opts.nodeLinker === 'hoisted') {
    const lockfileToDepGraphOpts: LockfileToHoistedDepGraphOptions = {
      ...opts,
      importerIds,
      lockfileDir,
      skipped,
      virtualStoreDir,
      nodeVersion: opts.currentEngine.nodeVersion,
      pnpmVersion: opts.currentEngine.pnpmVersion,
      supportedArchitectures: opts.supportedArchitectures,
    } satisfies LockfileToHoistedDepGraphOptions;

    const {
      directDependenciesByImporterId,
      graph,
      hierarchy,
      prevGraph,
      pkgLocationsByDepPath,
      symlinkedDirectDependenciesByImporterId,
    } = await lockfileToHoistedDepGraph(
      filteredLockfile,
      currentLockfile,
      lockfileToDepGraphOpts
    );

    if (opts.enablePnp === true) {
      const importerNames = Object.fromEntries(
        selectedProjects.map(
          ({
            manifest,
            id,
          }: ProjectOptions &
            HookOptions & {
              binsDir: string;
            }): [ProjectId, string] => {
            return [id, manifest?.name ?? id];
          }
        )
      );

      await writePnpFile(filteredLockfile, {
        importerNames,
        lockfileDir,
        virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
        registries: opts.registries,
      });
    }

    const depNodes = Object.values(graph);

    const added = depNodes.filter(
      ({ fetching }: DependenciesGraphNode): boolean => {
        return typeof fetching === 'function';
      }
    ).length;

    statsLogger.debug({
      added,
      prefix: lockfileDir,
    });

    const allowBuild = createAllowBuildFunction({
      neverBuiltDependencies: opts.neverBuiltDependencies as string[],
      onlyBuiltDependencies: opts.onlyBuiltDependencies as string[],
      onlyBuiltDependenciesFile: opts.onlyBuiltDependenciesFile as string,
    });

    if (hierarchy && prevGraph) {
      await linkHoistedModules(
        opts.storeController,
        graph,
        prevGraph,
        hierarchy,
        {
          allowBuild,
          depsStateCache,
          disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
          force: opts.force,
          ignoreScripts: opts.ignoreScripts,
          lockfileDir: opts.lockfileDir,
          preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
          sideEffectsCacheRead: opts.sideEffectsCacheRead,
        }
      );

      stageLogger.debug({
        prefix: lockfileDir,
        stage: 'importing_done',
      });

      linkedToRoot = await symlinkDirectDependencies({
        directDependenciesByImporterId: symlinkedDirectDependenciesByImporterId,
        dedupe: Boolean(opts.dedupeDirectDeps),
        filteredLockfile,
        lockfileDir,
        projects: selectedProjects,
        registries: opts.registries,
        symlink: opts.symlink,
      });
    }

    if (opts.ignoreScripts === true) {
      for (const { id, manifest } of selectedProjects) {
        if (
          manifest?.scripts != null &&
          (typeof manifest.scripts.preinstall === 'string' ||
            typeof manifest.scripts.prepublish === 'string' ||
            typeof manifest.scripts.install === 'string' ||
            typeof manifest.scripts.postinstall === 'string' ||
            typeof manifest.scripts.prepare === 'string')
        ) {
          opts.pendingBuilds.push(id);
        }
      }

      // we can use concat here because we always only append new packages, which are guaranteed to not be there by definition
      opts.pendingBuilds = opts.pendingBuilds.concat(
        depNodes
          .filter(({ requiresBuild }: DependenciesGraphNode): boolean => {
            return requiresBuild === true;
          })
          .map(({ depPath }: DependenciesGraphNode): string => {
            return depPath;
          })
      );
    }

    let ignoredBuilds: string[] | undefined;

    if (
      (opts.ignoreScripts !== true ||
        Object.keys(opts.patchedDependencies ?? {}).length > 0) &&
      opts.enableModulesDir !== false
    ) {
      const directNodes = new Set<string>();

      for (const id of union.default(importerIds, ['.'])) {
        const directDependencies = directDependenciesByImporterId[id];

        if (typeof directDependencies === 'undefined') {
          continue;
        }

        for (const alias in directDependencies) {
          const loc = directDependencies[alias];

          if (typeof loc === 'undefined') {
            continue;
          }

          if (!graph[loc]) {
            continue;
          }

          directNodes.add(loc);
        }
      }

      const extraBinPaths = [...(opts.extraBinPaths ?? [])];

      if (opts.hoistPattern != null) {
        extraBinPaths.unshift(path.join(virtualStoreDir, 'node_modules/.bin'));
      }

      let extraEnv: Record<string, string> | undefined = opts.extraEnv;

      if (opts.enablePnp === true) {
        extraEnv = {
          ...extraEnv,
          ...makeNodeRequireOption(path.join(opts.lockfileDir, '.pnp.cjs')),
        };
      }

      ignoredBuilds = (
        await buildModules(graph, Array.from(directNodes), {
          allowBuild,
          ignoredBuiltDependencies: opts.ignoredBuiltDependencies,
          childConcurrency: opts.childConcurrency,
          extraBinPaths,
          extraEnv,
          depsStateCache,
          ignoreScripts: opts.ignoreScripts || opts.ignoreDepScripts,
          hoistedLocations: undefined,
          lockfileDir,
          optional: opts.include.optionalDependencies,
          preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
          rawConfig: opts.rawConfig,
          rootModulesDir: virtualStoreDir,
          scriptsPrependNodePath: opts.scriptsPrependNodePath,
          scriptShell: opts.scriptShell,
          shellEmulator: opts.shellEmulator,
          sideEffectsCacheWrite: opts.sideEffectsCacheWrite,
          storeController: opts.storeController,
          unsafePerm: opts.unsafePerm,
          userAgent: opts.userAgent,
        })
      ).ignoredBuilds;

      if (
        typeof ignoredBuilds === 'undefined' &&
        typeof opts.modulesFile?.ignoredBuilds?.length === 'number'
      ) {
        ignoredBuilds = opts.modulesFile.ignoredBuilds;

        ignoredScriptsLogger.debug({ packageNames: ignoredBuilds });
      }
    }

    const projectsToBeBuilt = extendProjectsWithTargetDirs(
      selectedProjects,
      wantedLockfile,
      {
        pkgLocationsByDepPath,
        virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      }
    );

    if (opts.enableModulesDir !== false) {
      const rootProjectDeps =
        opts.dedupeDirectDeps === true
          ? (directDependenciesByImporterId['.'] ?? {})
          : {};

      /** Skip linking and due to no project manifest */
      if (opts.ignorePackageManifest !== true) {
        await Promise.all(
          selectedProjects.map(
            async (
              project: ProjectOptions &
                HookOptions & {
                  binsDir: string;
                }
            ): Promise<void> => {
              if (
                opts.nodeLinker === 'hoisted' ||
                (typeof opts.publicHoistPattern?.length === 'number' &&
                  path.relative(opts.lockfileDir, project.rootDir) === '')
              ) {
                await linkBinsOfImporter(project, {
                  extraNodePaths: opts.extraNodePaths,
                  preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
                });

                return;
              }

              let directPkgDirs: string[];

              if (project.id === '.') {
                directPkgDirs = Object.values(
                  directDependenciesByImporterId[project.id] ?? {}
                );
              } else {
                directPkgDirs = [];

                for (const [alias, dir] of Object.entries(
                  directDependenciesByImporterId[project.id] ?? {}
                )) {
                  if (rootProjectDeps[alias] !== dir) {
                    directPkgDirs.push(dir);
                  }
                }
              }

              await linkBinsOfPackages(
                (
                  await Promise.all(
                    directPkgDirs.map(
                      async (
                        dir: string
                      ): Promise<{
                        location: string;
                        manifest: ProjectManifest | null;
                      }> => ({
                        location: dir,
                        manifest: await safeReadProjectManifestOnly(dir),
                      })
                    )
                  )
                ).filter(
                  ({
                    manifest,
                  }: {
                    location: string;
                    manifest: ProjectManifest | null;
                  }): boolean => {
                    return manifest != null;
                  }
                ) as Array<{
                  location: string;
                  manifest: DependencyManifest;
                }>,
                project.binsDir,
                {
                  extraNodePaths: opts.extraNodePaths,
                  preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
                }
              );
            }
          )
        );
      }

      const injectedDeps: Record<string, string[]> = {};

      for (const project of projectsToBeBuilt) {
        if (project.targetDirs.length > 0) {
          injectedDeps[project.id] = project.targetDirs.map(
            (targetDir: string): string => {
              return path.relative(opts.lockfileDir, targetDir);
            }
          );
        }
      }

      await writeModulesManifest(
        rootModulesDir,
        {
          hoistedDependencies: newHoistedDependencies ?? {},
          hoistPattern: opts.hoistPattern,
          included: opts.include,
          injectedDeps,
          ignoredBuilds,
          layoutVersion: LAYOUT_VERSION,
          hoistedLocations: undefined,
          nodeLinker: opts.nodeLinker,
          packageManager: `${opts.packageManager.name}@${opts.packageManager.version}`,
          pendingBuilds: opts.pendingBuilds,
          publicHoistPattern: opts.publicHoistPattern,
          prunedAt:
            opts.pruneVirtualStore === true || opts.prunedAt == null
              ? new Date().toUTCString()
              : opts.prunedAt,
          registries: opts.registries,
          skipped: Array.from(skipped),
          storeDir: opts.storeDir,
          virtualStoreDir,
          virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
        },
        {
          makeModulesDir:
            Object.keys(filteredLockfile.packages ?? {}).length > 0,
        }
      );

      if (opts.useLockfile === true) {
        // We need to write the wanted lockfile as well.
        // Even though it will only be changed if the workspace will have new projects with no dependencies.
        await writeLockfiles({
          wantedLockfileDir: opts.lockfileDir,
          currentLockfileDir: virtualStoreDir,
          wantedLockfile,
          currentLockfile: filteredLockfile,
        });
      } else {
        await writeCurrentLockfile(virtualStoreDir, filteredLockfile);
      }
    }

    // waiting till package requests are finished
    await Promise.all(
      depNodes.map(async ({ fetching }) => {
        try {
          await fetching?.();
        } catch {}
      })
    );

    summaryLogger.debug({ prefix: lockfileDir });

    await opts.storeController.close();

    if (!opts.ignoreScripts && opts.ignorePackageManifest !== true) {
      await runLifecycleHooksConcurrently(
        [
          'preinstall',
          'install',
          'postinstall',
          'preprepare',
          'prepare',
          'postprepare',
        ],
        projectsToBeBuilt,
        opts.childConcurrency ?? 5,
        scriptsOpts
      );
    }

    if (reporter != null && typeof reporter === 'function') {
      streamParser.removeListener('data', reporter);
    }

    return {
      stats: {
        added,
        removed,
        linkedToRoot,
      },
      ignoredBuilds,
    };
  }

  const lockfileToDepGraphOpts: LockfileToDepGraphOptions = {
    ...opts,
    importerIds,
    lockfileDir,
    skipped,
    virtualStoreDir,
    nodeVersion: opts.currentEngine.nodeVersion,
    pnpmVersion: opts.currentEngine.pnpmVersion,
    supportedArchitectures: opts.supportedArchitectures,
  } satisfies LockfileToDepGraphOptions;

  const {
    directDependenciesByImporterId,
    graph,
    // hierarchy,
    // hoistedLocations,
    // pkgLocationsByDepPath,
    // prevGraph,
    // symlinkedDirectDependenciesByImporterId,
  } = await lockfileToDepGraph(
    filteredLockfile,
    opts.force ? null : currentLockfile,
    lockfileToDepGraphOpts
  );

  if (opts.enablePnp === true) {
    const importerNames = Object.fromEntries(
      selectedProjects.map(
        ({
          manifest,
          id,
        }: ProjectOptions &
          HookOptions & {
            binsDir: string;
          }): [ProjectId, string] => {
          return [id, manifest?.name ?? id];
        }
      )
    );

    await writePnpFile(filteredLockfile, {
      importerNames,
      lockfileDir,
      virtualStoreDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      registries: opts.registries,
    });
  }

  const depNodes = Object.values(graph);

  const added = depNodes.filter(
    ({ fetching }: DependenciesGraphNode): boolean => {
      return typeof fetching === 'function';
    }
  ).length;

  statsLogger.debug({
    added,
    prefix: lockfileDir,
  });

  const allowBuild = createAllowBuildFunction({
    neverBuiltDependencies: opts.neverBuiltDependencies as string[],
    onlyBuiltDependencies: opts.onlyBuiltDependencies as string[],
    onlyBuiltDependenciesFile: opts.onlyBuiltDependenciesFile as string,
  });

  if (opts.enableModulesDir !== false) {
    await Promise.all(
      depNodes.map(
        async (depNode: DependenciesGraphNode): Promise<string | undefined> => {
          return fs.mkdir(depNode.modules, { recursive: true });
        }
      )
    );

    await Promise.all([
      opts.symlink === false
        ? Promise.resolve()
        : linkAllModules(depNodes, {
            optional: opts.include.optionalDependencies,
          }),
      linkAllPkgs(opts.storeController, depNodes, {
        allowBuild,
        force: opts.force,
        disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
        depGraph: graph,
        depsStateCache,
        ignoreScripts: opts.ignoreScripts,
        lockfileDir: opts.lockfileDir,
        sideEffectsCacheRead: opts.sideEffectsCacheRead,
      }),
    ]);

    stageLogger.debug({
      prefix: lockfileDir,
      stage: 'importing_done',
    });

    if (
      opts.ignorePackageManifest !== true &&
      (opts.hoistPattern != null || opts.publicHoistPattern != null)
    ) {
      // It is important to keep the skipped packages in the lockfile which will be saved as the "current lockfile".
      // pnpm is comparing the current lockfile to the wanted one and they should match.
      // But for hoisting, we need a version of the lockfile w/o the skipped packages, so we're making a copy.
      const hoistLockfile = {
        ...filteredLockfile,
        packages:
          typeof filteredLockfile.packages === 'undefined'
            ? {}
            : omit.default(Array.from(skipped), filteredLockfile.packages),
      };

      newHoistedDependencies = await hoist({
        extraNodePath: opts.extraNodePaths,
        lockfile: hoistLockfile,
        importerIds,
        preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
        privateHoistedModulesDir: hoistedModulesDir,
        privateHoistPattern: opts.hoistPattern ?? [],
        publicHoistedModulesDir,
        publicHoistPattern: opts.publicHoistPattern ?? [],
        virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
        hoistedWorkspacePackages:
          opts.hoistWorkspacePackages === true
            ? Object.values(opts.allProjects).reduce(
                (
                  hoistedWorkspacePackages: Record<
                    string,
                    HoistedWorkspaceProject
                  >,
                  project: ProjectOptions &
                    HookOptions & {
                      binsDir: string;
                    }
                ): Record<string, HoistedWorkspaceProject> => {
                  if (
                    typeof project.manifest?.name === 'string' &&
                    project.id !== '.'
                  ) {
                    hoistedWorkspacePackages[project.id] = {
                      dir: project.rootDir,
                      name: project.manifest.name,
                    };
                  }
                  return hoistedWorkspacePackages;
                },
                {} as Record<string, HoistedWorkspaceProject>
              )
            : undefined,
      });
    } else {
      newHoistedDependencies = {};
    }

    await linkAllBins(graph, {
      extraNodePaths: opts.extraNodePaths,
      optional: opts.include.optionalDependencies,
      preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
      warn,
    });

    if (
      currentLockfile !== null &&
      !equals.default(
        importerIds.sort(),
        Object.keys(filteredLockfile.importers ?? {}).sort()
      )
    ) {
      Object.assign(filteredLockfile.packages ?? {}, currentLockfile.packages);
    }

    /** Skip linking and due to no project manifest */
    if (opts.ignorePackageManifest !== true) {
      linkedToRoot = await symlinkDirectDependencies({
        dedupe: Boolean(opts.dedupeDirectDeps),
        directDependenciesByImporterId,
        filteredLockfile,
        lockfileDir,
        projects: selectedProjects,
        registries: opts.registries,
        symlink: opts.symlink,
      });
    }
  }

  if (opts.ignoreScripts === true) {
    for (const { id, manifest } of selectedProjects) {
      if (
        typeof manifest?.scripts !== 'undefined' &&
        (typeof manifest.scripts.preinstall === 'string' ||
          typeof manifest.scripts.prepublish === 'string' ||
          typeof manifest.scripts.install === 'string' ||
          typeof manifest.scripts.postinstall === 'string' ||
          typeof manifest.scripts.prepare === 'string')
      ) {
        opts.pendingBuilds.push(id);
      }
    }

    // we can use concat here because we always only append new packages, which are guaranteed to not be there by definition
    opts.pendingBuilds = opts.pendingBuilds.concat(
      depNodes
        .filter(({ requiresBuild }: DependenciesGraphNode): boolean => {
          return requiresBuild === true;
        })
        .map(({ depPath }: DependenciesGraphNode): string => {
          return depPath;
        })
    );
  }

  let ignoredBuilds: string[] | undefined;

  if (
    (!opts.ignoreScripts ||
      Object.keys(opts.patchedDependencies ?? {}).length > 0) &&
    opts.enableModulesDir !== false
  ) {
    const directNodes = new Set<string>();

    for (const id of union.default(importerIds, ['.'])) {
      const directDependencies = directDependenciesByImporterId[id];

      for (const alias in directDependencies) {
        const loc = directDependencies[alias];

        if (typeof loc === 'undefined') {
          continue;
        }

        if (!graph[loc]) {
          continue;
        }

        directNodes.add(loc);
      }
    }

    const extraBinPaths = [...(opts.extraBinPaths ?? [])];

    if (opts.hoistPattern != null) {
      extraBinPaths.unshift(path.join(virtualStoreDir, 'node_modules/.bin'));
    }

    let extraEnv: Record<string, string> | undefined = opts.extraEnv;

    if (opts.enablePnp === true) {
      extraEnv = {
        ...extraEnv,
        ...makeNodeRequireOption(path.join(opts.lockfileDir, '.pnp.cjs')),
      };
    }

    ignoredBuilds = (
      await buildModules(graph, Array.from(directNodes), {
        allowBuild,
        ignoredBuiltDependencies: opts.ignoredBuiltDependencies,
        childConcurrency: opts.childConcurrency,
        extraBinPaths,
        extraEnv,
        depsStateCache,
        ignoreScripts: opts.ignoreScripts || opts.ignoreDepScripts,
        hoistedLocations: undefined,
        lockfileDir,
        optional: opts.include.optionalDependencies,
        preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
        rawConfig: opts.rawConfig,
        rootModulesDir: virtualStoreDir,
        scriptsPrependNodePath: opts.scriptsPrependNodePath,
        scriptShell: opts.scriptShell,
        shellEmulator: opts.shellEmulator,
        sideEffectsCacheWrite: opts.sideEffectsCacheWrite,
        storeController: opts.storeController,
        unsafePerm: opts.unsafePerm,
        userAgent: opts.userAgent,
      })
    ).ignoredBuilds;

    if (
      typeof ignoredBuilds === 'undefined' &&
      typeof opts.modulesFile?.ignoredBuilds?.length === 'number'
    ) {
      ignoredBuilds = opts.modulesFile.ignoredBuilds;

      ignoredScriptsLogger.debug({ packageNames: ignoredBuilds });
    }
  }

  const projectsToBeBuilt = extendProjectsWithTargetDirs(
    selectedProjects,
    wantedLockfile,
    {
      pkgLocationsByDepPath: {},
      virtualStoreDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    }
  );

  if (opts.enableModulesDir !== false) {
    const rootProjectDeps =
      opts.dedupeDirectDeps === true
        ? (directDependenciesByImporterId['.'] ?? {})
        : {};
    /** Skip linking and due to no project manifest */
    if (opts.ignorePackageManifest !== true) {
      await Promise.all(
        selectedProjects.map(async (project) => {
          if (
            opts.nodeLinker === 'hoisted' ||
            (typeof opts.publicHoistPattern?.length === 'number' &&
              path.relative(opts.lockfileDir, project.rootDir) === '')
          ) {
            await linkBinsOfImporter(project, {
              extraNodePaths: opts.extraNodePaths,
              preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
            });
          } else {
            let directPkgDirs: string[];

            if (project.id === '.') {
              directPkgDirs = Object.values(
                directDependenciesByImporterId[project.id] ?? {}
              );
            } else {
              directPkgDirs = [];

              for (const [alias, dir] of Object.entries(
                directDependenciesByImporterId[project.id] ?? {}
              )) {
                if (rootProjectDeps[alias] !== dir) {
                  directPkgDirs.push(dir);
                }
              }
            }

            await linkBinsOfPackages(
              (
                await Promise.all(
                  directPkgDirs.map(async (dir) => ({
                    location: dir,
                    manifest: await safeReadProjectManifestOnly(dir),
                  }))
                )
              ).filter(
                ({
                  manifest,
                }: {
                  location: string;
                  manifest: ProjectManifest | null;
                }): boolean => {
                  return manifest != null;
                }
              ) as Array<{
                location: string;
                manifest: DependencyManifest;
              }>,
              project.binsDir,
              {
                extraNodePaths: opts.extraNodePaths,
                preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
              }
            );
          }
        })
      );
    }
    const injectedDeps: Record<string, string[]> = {};

    for (const project of projectsToBeBuilt) {
      if (project.targetDirs.length > 0) {
        injectedDeps[project.id] = project.targetDirs.map(
          (targetDir: string): string => {
            return path.relative(opts.lockfileDir, targetDir);
          }
        );
      }
    }

    await writeModulesManifest(
      rootModulesDir,
      {
        hoistedDependencies: newHoistedDependencies ?? {},
        hoistPattern: opts.hoistPattern,
        included: opts.include,
        injectedDeps,
        ignoredBuilds,
        layoutVersion: LAYOUT_VERSION,
        hoistedLocations: undefined,
        nodeLinker: opts.nodeLinker,
        packageManager: `${opts.packageManager.name}@${opts.packageManager.version}`,
        pendingBuilds: opts.pendingBuilds,
        publicHoistPattern: opts.publicHoistPattern,
        prunedAt:
          opts.pruneVirtualStore === true || opts.prunedAt == null
            ? new Date().toUTCString()
            : opts.prunedAt,
        registries: opts.registries,
        skipped: Array.from(skipped),
        storeDir: opts.storeDir,
        virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      },
      {
        makeModulesDir: Object.keys(filteredLockfile.packages ?? {}).length > 0,
      }
    );

    if (opts.useLockfile === true) {
      // We need to write the wanted lockfile as well.
      // Even though it will only be changed if the workspace will have new projects with no dependencies.
      await writeLockfiles({
        wantedLockfileDir: opts.lockfileDir,
        currentLockfileDir: virtualStoreDir,
        wantedLockfile,
        currentLockfile: filteredLockfile,
      });
    } else {
      await writeCurrentLockfile(virtualStoreDir, filteredLockfile);
    }
  }

  // waiting till package requests are finished
  await Promise.all(
    depNodes.map(async ({ fetching }) => {
      try {
        await fetching?.();
      } catch {}
    })
  );

  summaryLogger.debug({ prefix: lockfileDir });

  await opts.storeController.close();

  if (!opts.ignoreScripts && opts.ignorePackageManifest !== true) {
    await runLifecycleHooksConcurrently(
      [
        'preinstall',
        'install',
        'postinstall',
        'preprepare',
        'prepare',
        'postprepare',
      ],
      projectsToBeBuilt,
      opts.childConcurrency ?? 5,
      scriptsOpts
    );
  }

  if (reporter != null && typeof reporter === 'function') {
    streamParser.removeListener('data', reporter);
  }

  return {
    stats: {
      added,
      removed,
      linkedToRoot,
    },
    ignoredBuilds,
  };
}

type SymlinkDirectDependenciesOpts = Pick<
  HeadlessOptions,
  'registries' | 'symlink' | 'lockfileDir'
> & {
  filteredLockfile: LockfileObject;
  dedupe: boolean;
  directDependenciesByImporterId: DirectDependenciesByImporterId;
  projects: (ProjectOptions &
    HookOptions & {
      binsDir: string;
    })[];
};

async function symlinkDirectDependencies({
  filteredLockfile,
  dedupe,
  directDependenciesByImporterId,
  lockfileDir,
  projects,
  registries,
  symlink,
}: SymlinkDirectDependenciesOpts): Promise<number> {
  for (const { rootDir, manifest } of projects) {
    // Even though headless installation will never update the package.json
    // this needs to be logged because otherwise install summary won't be printed
    packageManifestLogger.debug({
      prefix: rootDir,
      updated: manifest,
    });
  }

  if (symlink === false) {
    return 0;
  }

  const importerManifestsByImporterId: { [id: string]: ProjectManifest } = {};

  for (const { id, manifest } of projects) {
    if (typeof manifest !== 'undefined') {
      importerManifestsByImporterId[id] = manifest;
    }
  }

  const projectsToLink = Object.fromEntries(
    await Promise.all(
      projects.map(
        async ({
          rootDir,
          id,
          modulesDir,
        }: ProjectOptions &
          HookOptions & {
            binsDir: string;
          }): Promise<
          [
            ProjectId,
            {
              dir:
                | ProjectRootDir
                | ProjectRootDirRealPath
                | GlobalPkgDir
                | WorkspaceDir
                | LockFileDir;
              modulesDir: ModulesDir;
              dependencies: LinkedDirectDep[];
            },
          ]
        > => {
          return [
            id,
            {
              dir: rootDir,
              modulesDir,
              dependencies: await getRootPackagesToLink(filteredLockfile, {
                importerId: id,
                importerModulesDir: modulesDir,
                lockfileDir,
                projectDir: rootDir,
                importerManifestsByImporterId,
                registries,
                rootDependencies: directDependenciesByImporterId[id] ?? {},
              }),
            },
          ];
        }
      )
    )
  );

  const rootProject = projectsToLink['.'];

  if (typeof rootProject !== 'undefined' && dedupe) {
    const rootDeps = Object.fromEntries(
      rootProject.dependencies.map((dep: LinkedDirectDep) => [
        dep.alias,
        dep.dir,
      ])
    );

    for (const project of Object.values(omit.default(['.'], projectsToLink))) {
      project.dependencies = project.dependencies.filter(
        (dep: LinkedDirectDep): boolean => {
          return dep.dir !== rootDeps[dep.alias];
        }
      );
    }
  }
  return linkDirectDeps(projectsToLink, { dedupe: Boolean(dedupe) });
}

async function linkBinsOfImporter(
  {
    manifest,
    modulesDir,
    binsDir,
    rootDir,
  }: ProjectOptions & HookOptions & { binsDir: string },
  {
    extraNodePaths,
    preferSymlinkedExecutables,
  }: {
    extraNodePaths?: string[] | undefined;
    preferSymlinkedExecutables?: boolean | undefined;
  } = {}
): Promise<string[]> {
  function warn(message: string): void {
    logger.info({ message, prefix: rootDir });
  }

  return linkBins(modulesDir, binsDir, {
    extraNodePaths,
    allowExoticManifests: true,
    preferSymlinkedExecutables,
    projectManifest: manifest,
    warn,
  });
}

async function getRootPackagesToLink(
  lockfile: LockfileObject,
  opts: {
    registries: Registries;
    projectDir: string;
    importerId: ProjectId;
    importerModulesDir?: ModulesDir | undefined;
    importerManifestsByImporterId: { [id: string]: ProjectManifest };
    lockfileDir: string;
    rootDependencies: { [alias: string]: string };
  }
): Promise<LinkedDirectDep[]> {
  const projectSnapshot = lockfile.importers?.[opts.importerId];

  const allDeps = {
    ...projectSnapshot?.devDependencies,
    ...projectSnapshot?.dependencies,
    ...projectSnapshot?.optionalDependencies,
  };

  return (
    await Promise.all(
      Object.entries(allDeps).map(
        async ([alias, ref]: [string, string]): Promise<
          | {
              alias: string;
              isExternalLink: boolean;
              name: string;
              version: string;
              dependencyType: string;
              dir: string;
              id: string | undefined;
            }
          | undefined
        > => {
          if (ref.startsWith('link:')) {
            const isDev = Boolean(projectSnapshot?.devDependencies?.[alias]);

            const isOptional = Boolean(
              projectSnapshot?.optionalDependencies?.[alias]
            );

            const packageDir = path.join(opts.projectDir, ref.slice(5));

            const linkedPackage =
              await (async (): Promise<DependencyManifest> => {
                const importerId = getLockfileImporterId(
                  opts.lockfileDir,
                  packageDir
                );

                if (opts.importerManifestsByImporterId[importerId]) {
                  return opts.importerManifestsByImporterId[importerId];
                }

                try {
                  return await readProjectManifestOnly(packageDir);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (err: any) {
                  if (err['code'] !== 'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND') {
                    throw err;
                  }

                  return { name: alias, version: '0.0.0' };
                }
              })();

            return {
              alias,
              name: linkedPackage.name,
              version: linkedPackage.version,
              dir: packageDir,
              id: ref,
              isExternalLink: true,
              dependencyType: isDev ? 'dev' : isOptional ? 'optional' : 'prod',
            };
          }

          const dir = opts.rootDependencies[alias];

          // Skipping linked packages
          if (typeof dir === 'undefined') {
            return;
          }

          const isDev = Boolean(projectSnapshot?.devDependencies?.[alias]);

          const isOptional = Boolean(
            projectSnapshot?.optionalDependencies?.[alias]
          );

          const depPath = dp.refToRelative(ref, alias);

          if (depPath === null) {
            return;
          }

          const pkgSnapshot = lockfile.packages?.[depPath];

          // this won't ever happen. Just making typescript happy
          if (pkgSnapshot == null) {
            return;
          }

          const pkgId =
            pkgSnapshot.id ?? dp.refToRelative(ref, alias) ?? undefined;

          const pkgInfo = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

          return {
            alias,
            isExternalLink: false,
            name: pkgInfo.name,
            version: pkgInfo.version,
            dependencyType: isDev ? 'dev' : isOptional ? 'optional' : 'prod',
            dir,
            id: pkgId,
          };
        }
      )
    )
  ).filter(Boolean) as LinkedDirectDep[];
}

const limitLinking = pLimit(16);

async function linkAllPkgs(
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      importMethod?: string | undefined;
      isBuilt: boolean;
    }
  >,
  depNodes: DependenciesGraphNode[],
  opts: {
    allowBuild?: ((pkgName: string) => boolean) | undefined;
    depGraph: DependenciesGraph;
    depsStateCache: DepsStateCache;
    disableRelinkLocalDirDeps?: boolean | undefined;
    force: boolean;
    ignoreScripts: boolean;
    lockfileDir: string;
    sideEffectsCacheRead: boolean;
  }
): Promise<void> {
  await Promise.all(
    depNodes.map(async (depNode: DependenciesGraphNode): Promise<void> => {
      if (!depNode.fetching) {
        return;
      }

      let filesResponse: PackageFilesResponse | undefined;

      try {
        filesResponse = (await depNode.fetching()).files;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (depNode.optional) {
          return;
        }

        throw err;
      }

      depNode.requiresBuild = filesResponse.requiresBuild;

      let sideEffectsCacheKey: string | undefined;

      if (
        opts.sideEffectsCacheRead &&
        filesResponse.sideEffects &&
        !isEmpty.default(filesResponse.sideEffects)
      ) {
        if (opts.allowBuild?.(depNode.name) !== false) {
          sideEffectsCacheKey = calcDepState(
            opts.depGraph,
            opts.depsStateCache,
            depNode.dir,
            {
              isBuilt: !opts.ignoreScripts && depNode.requiresBuild,
              patchFileHash: depNode.patch?.file.hash,
            }
          );
        }
      }

      const { importMethod, isBuilt } = await storeController.importPackage(
        depNode.dir,
        {
          filesResponse,
          force: opts.force,
          disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
          requiresBuild: depNode.patch != null || depNode.requiresBuild,
          sideEffectsCacheKey,
        }
      );

      if (typeof importMethod === 'string') {
        progressLogger.debug({
          method: importMethod,
          requester: opts.lockfileDir,
          status: 'imported',
          to: depNode.dir,
        });
      }

      depNode.isBuilt = isBuilt;

      const selfDep = depNode.children[depNode.name];

      if (typeof selfDep === 'string') {
        const pkg = opts.depGraph[selfDep];

        if (typeof pkg === 'undefined') {
          return;
        }

        const targetModulesDir = path.join(
          depNode.modules,
          depNode.name,
          'node_modules'
        );

        await limitLinking(
          async (): Promise<{ reused: boolean; warn?: string | undefined }> => {
            return symlinkDependency(pkg.dir, targetModulesDir, depNode.name);
          }
        );
      }
    })
  );
}

async function linkAllBins(
  depGraph: DependenciesGraph,
  opts: {
    extraNodePaths?: string[] | undefined;
    optional: boolean;
    preferSymlinkedExecutables?: boolean | undefined;
    warn: (message: string) => void;
  }
): Promise<void> {
  await Promise.all(
    Object.values(depGraph).map(
      async (depNode: DependenciesGraphNode): Promise<void> => {
        return limitLinking(async (): Promise<void> => {
          const childrenToLink: Record<string, string> = opts.optional
            ? depNode.children
            : pickBy.default((_, childAlias: string): boolean => {
                return !depNode.optionalDependencies.has(childAlias);
              }, depNode.children);

          const binPath = path.join(depNode.dir, 'node_modules/.bin');

          const pkgSnapshots = props.default<string, DependenciesGraphNode>(
            Object.values(childrenToLink),
            depGraph
          );

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (pkgSnapshots.includes(undefined as any)) {
            await linkBins(depNode.modules, binPath, {
              extraNodePaths: opts.extraNodePaths,
              preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
              warn: opts.warn,
            });
          } else {
            const pkgs = await Promise.all(
              pkgSnapshots
                .filter(({ hasBin }: DependenciesGraphNode): boolean => {
                  return hasBin;
                })
                .map(
                  async ({
                    dir,
                  }: DependenciesGraphNode): Promise<{
                    location: string;
                    manifest: DependencyManifest;
                  }> => {
                    return {
                      location: dir,
                      manifest: await readPackageJsonFromDir(dir),
                    };
                  }
                )
            );

            await linkBinsOfPackages(pkgs, binPath, {
              extraNodePaths: opts.extraNodePaths,
              preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
            });
          }

          // link also the bundled dependencies` bins
          if (depNode.hasBundledDependencies) {
            const bundledModules = path.join(
              depNode.dir,
              'node_modules'
            ) as ModulesDir;

            await linkBins(bundledModules, binPath, {
              extraNodePaths: opts.extraNodePaths,
              preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
              warn: opts.warn,
            });
          }
        });
      }
    )
  );
}

async function linkAllModules(
  depNodes: Array<
    Pick<
      DependenciesGraphNode,
      'children' | 'optionalDependencies' | 'modules' | 'name'
    >
  >,
  opts: {
    optional: boolean;
  }
): Promise<void> {
  await symlinkAllModules({
    deps: depNodes.map(
      (
        depNode: Pick<
          DependenciesGraphNode,
          'children' | 'optionalDependencies' | 'modules' | 'name'
        >
      ): {
        children: Record<string, string>;
        modules: string;
        name: string;
      } => {
        return {
          children: opts.optional
            ? depNode.children
            : pickBy.default((_, childAlias: string): boolean => {
                return !depNode.optionalDependencies.has(childAlias);
              }, depNode.children),
          modules: depNode.modules,
          name: depNode.name,
        };
      }
    ),
  });
}
