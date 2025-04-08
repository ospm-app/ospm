import assert from 'node:assert';
import path from 'node:path';
import util from 'node:util';
import {
  getIndexFilePathInCafs,
  type PackageFilesIndex,
} from '../../store.cafs/index.ts';
import {
  calcDepState,
  lockfileToDepGraph,
  type DepsStateCache,
} from '../../calc-dep-state/index.ts';
import { LAYOUT_VERSION, WANTED_LOCKFILE } from '../../constants/index.ts';
import { skippedOptionalDependencyLogger } from '../../core-loggers/index.ts';
import { PnpmError } from '../../error/index.ts';
import {
  getContext,
  type HookOptions,
  type PnpmContext,
  type ProjectOptions,
} from '../../get-context/index.ts';
import {
  runLifecycleHooksConcurrently,
  runPostinstallHooks,
  type RunLifecycleHooksConcurrentlyOptions,
} from '../../lifecycle/index.ts';
import { linkBins } from '../../link-bins/index.ts';
import {
  nameVerFromPkgSnapshot,
  packageIsIndependent,
} from '../../lockfile.utils/index.ts';
import {
  lockfileWalker,
  type LockfileWalkerStep,
} from '../../lockfile.walker/index.ts';
import { logger, streamParser } from '../../logger/index.ts';
import { writeModulesManifest } from '../../modules-yaml/index.ts';
import { createOrConnectStoreController } from '../../store-connection-manager/index.ts';
import type {
  DepPath,
  GlobalPkgDir,
  LockFileDir,
  ModulesDir,
  ProjectId,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../../types/index.ts';
import { createAllowBuildFunction } from '@pnpm/builder.policy';
import * as dp from '../../dependency-path/index.ts';
import { hardLinkDir } from '../../worker/index.ts';
import { loadJsonFile } from 'load-json-file';
import runGroups from 'run-groups';
import {
  graphSequencer,
  type Graph,
} from '../../deps.graph-sequencer/index.ts';

import { npa } from '../../npm-package-arg/index.ts';
import pLimit from 'p-limit';
import semver from 'semver';
import {
  extendRebuildOptions,
  type RebuildOptions,
  type StrictRebuildOptions,
} from './extendRebuildOptions.ts';
import type {
  PackageSnapshots,
  LockfileObject,
} from 'src/packages/lockfile.types/index.ts';

export type { RebuildOptions };

function findPackages(
  packages: PackageSnapshots,
  searched: PackageSelector[],
  opts: {
    prefix: string;
  }
): DepPath[] {
  return (Object.keys(packages) as DepPath[]).filter((relativeDepPath) => {
    const pkgLockfile = packages[relativeDepPath];

    if (typeof pkgLockfile === 'undefined') {
      return false;
    }

    const pkgInfo = nameVerFromPkgSnapshot(relativeDepPath, pkgLockfile);

    if (!pkgInfo.name) {
      logger.warn({
        message: `Skipping ${relativeDepPath} because cannot get the package name from ${WANTED_LOCKFILE}.
            Try to run run \`pnpm update --depth 100\` to create a new ${WANTED_LOCKFILE} with all the necessary info.`,
        prefix: opts.prefix,
      });

      return false;
    }

    return matches(searched, pkgInfo);
  });
}

// TODO: move this logic to separate package as this is also used in dependencies-hierarchy
function matches(
  searched: PackageSelector[],
  manifest: { name: string; version?: string | undefined }
): boolean {
  return searched.some((searchedPkg: PackageSelector): boolean => {
    if (typeof searchedPkg === 'string') {
      return manifest.name === searchedPkg;
    }

    return (
      searchedPkg.name === manifest.name &&
      typeof manifest.version !== 'undefined' &&
      semver.satisfies(manifest.version, searchedPkg.range)
    );
  });
}

type PackageSelector =
  | string
  | {
      name: string;
      range: string;
    };

export async function rebuildSelectedPkgs<IP>(
  projects: Array<ProjectOptions & HookOptions & { binsDir: string }>,
  pkgSpecs: string[],
  maybeOpts: RebuildOptions<IP>
): Promise<void> {
  const reporter = maybeOpts.reporter;

  if (reporter != null && typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const opts = await extendRebuildOptions(maybeOpts);

  const ctx = await getContext({ ...opts, allProjects: projects });

  if (ctx.currentLockfile.packages == null) {
    return;
  }

  const packages = ctx.currentLockfile.packages;

  const searched: PackageSelector[] = pkgSpecs
    .map(
      (
        arg: string
      ):
        | string
        | { name: string | undefined; range: string | undefined }
        | undefined => {
        const { fetchSpec, name, raw, type } = npa(arg);

        if (raw === name) {
          return name;
        }

        if (type !== 'version' && type !== 'range') {
          throw new Error(
            `Invalid argument - ${arg}. Rebuild can only select by version or range`
          );
        }

        return {
          name,
          range: fetchSpec,
        };
      }
    )
    .filter(Boolean);

  let pkgs = [] as string[];

  for (const { rootDir } of projects) {
    pkgs = [...pkgs, ...findPackages(packages, searched, { prefix: rootDir })];
  }

  const { ignoredPkgs } = await _rebuild(
    {
      ...ctx,
      pkgsToRebuild: new Set(pkgs),
    },
    opts
  );

  await writeModulesManifest(ctx.rootModulesDir, {
    prunedAt: new Date().toUTCString(),
    ...ctx.modulesFile,
    hoistedDependencies: ctx.hoistedDependencies,
    hoistPattern: ctx.hoistPattern,
    included: ctx.include,
    ignoredBuilds: ignoredPkgs,
    layoutVersion: LAYOUT_VERSION,
    packageManager: `${opts.packageManager.name}@${opts.packageManager.version}`,
    pendingBuilds: ctx.pendingBuilds,
    publicHoistPattern: ctx.publicHoistPattern,
    registries: ctx.registries,
    skipped: Array.from(ctx.skipped),
    storeDir: ctx.storeDir,
    virtualStoreDir: ctx.virtualStoreDir,
    virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
  });
}

export async function rebuildProjects<IP>(
  projects: Array<ProjectOptions & HookOptions & { binsDir: string }>,
  maybeOpts: RebuildOptions<IP>
): Promise<void> {
  const reporter = maybeOpts.reporter;

  if (typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const opts = await extendRebuildOptions(maybeOpts);

  const ctx = await getContext({ ...opts, allProjects: projects });

  let idsToRebuild: string[] = [];

  if (opts.pending === true) {
    idsToRebuild = ctx.pendingBuilds;
  } else if (ctx.currentLockfile.packages != null) {
    idsToRebuild = Object.keys(ctx.currentLockfile.packages);
  }

  const { pkgsThatWereRebuilt, ignoredPkgs } = await _rebuild(
    {
      pkgsToRebuild: new Set(idsToRebuild),
      ...ctx,
    },
    opts
  );

  ctx.pendingBuilds = ctx.pendingBuilds.filter((depPath: string): boolean => {
    return !pkgsThatWereRebuilt.has(depPath);
  });

  const store = await createOrConnectStoreController(opts);

  const scriptsOpts: RunLifecycleHooksConcurrentlyOptions = {
    extraBinPaths: ctx.extraBinPaths,
    extraNodePaths: ctx.extraNodePaths,
    extraEnv: opts.extraEnv,
    preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
    rawConfig: opts.rawConfig,
    scriptsPrependNodePath: opts.scriptsPrependNodePath,
    scriptShell: opts.scriptShell,
    shellEmulator: opts.shellEmulator,
    storeController: store.ctrl,
    unsafePerm: opts.unsafePerm ?? false,
  };

  await runLifecycleHooksConcurrently(
    ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare'],
    Object.values(ctx.projects),
    opts.childConcurrency || 5,
    scriptsOpts
  );

  for (const { id, manifest } of Object.values(ctx.projects)) {
    if (
      typeof manifest?.scripts !== 'undefined' &&
      (opts.pending !== true || ctx.pendingBuilds.includes(id))
    ) {
      ctx.pendingBuilds.splice(ctx.pendingBuilds.indexOf(id), 1);
    }
  }

  await writeModulesManifest(ctx.rootModulesDir, {
    prunedAt: new Date().toUTCString(),
    ...ctx.modulesFile,
    hoistedDependencies: ctx.hoistedDependencies,
    hoistPattern: ctx.hoistPattern,
    included: ctx.include,
    ignoredBuilds: ignoredPkgs,
    layoutVersion: LAYOUT_VERSION,
    packageManager: `${opts.packageManager.name}@${opts.packageManager.version}`,
    pendingBuilds: ctx.pendingBuilds,
    publicHoistPattern: ctx.publicHoistPattern,
    registries: ctx.registries,
    skipped: Array.from(ctx.skipped),
    storeDir: ctx.storeDir,
    virtualStoreDir: ctx.virtualStoreDir,
    virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
  });
}

function getSubgraphToBuild(
  step: LockfileWalkerStep,
  nodesToBuildAndTransitive: Set<DepPath>,
  opts: {
    pkgsToRebuild: Set<string>;
  }
): boolean {
  let currentShouldBeBuilt = false;

  for (const { depPath, next } of step.dependencies) {
    if (nodesToBuildAndTransitive.has(depPath)) {
      currentShouldBeBuilt = true;
    }

    const childShouldBeBuilt =
      getSubgraphToBuild(next(), nodesToBuildAndTransitive, opts) ||
      opts.pkgsToRebuild.has(depPath);

    if (childShouldBeBuilt) {
      nodesToBuildAndTransitive.add(depPath);
      currentShouldBeBuilt = true;
    }
  }
  for (const depPath of step.missing) {
    // It might make sense to fail if the depPath is not in the skipped list from .modules.yaml
    // However, the skipped list currently contains package IDs, not dep paths.
    logger.debug({
      message: `No entry for "${depPath}" in ${WANTED_LOCKFILE}`,
    });
  }
  return currentShouldBeBuilt;
}

const limitLinking = pLimit(16);

async function _rebuild<IP>(
  ctx: {
    pkgsToRebuild: Set<string>;
    skipped: Set<string>;
    virtualStoreDir: string;
    rootModulesDir: string;
    currentLockfile: LockfileObject;
    projects: Record<
      string,
      {
        id: ProjectId;
        rootDir:
          | WorkspaceDir
          | ProjectRootDir
          | ProjectRootDirRealPath
          | GlobalPkgDir
          | LockFileDir;
      }
    >;
    extraBinPaths: string[];
    extraNodePaths: string[];
  } & Pick<PnpmContext, 'modulesFile'>,
  opts: StrictRebuildOptions<IP>
): Promise<{ pkgsThatWereRebuilt: Set<string>; ignoredPkgs: string[] }> {
  const depGraph = lockfileToDepGraph(ctx.currentLockfile);

  const depsStateCache: DepsStateCache = {};

  const pkgsThatWereRebuilt = new Set<string>();

  const graph: Graph<unknown> = new Map<DepPath, unknown[]>();

  const pkgSnapshots: PackageSnapshots = ctx.currentLockfile.packages ?? {};

  const nodesToBuildAndTransitive = new Set<DepPath>();

  getSubgraphToBuild(
    lockfileWalker(
      ctx.currentLockfile,
      Object.values(ctx.projects).map(({ id }) => id),
      {
        include: {
          dependencies: opts.production,
          devDependencies: opts.development,
          optionalDependencies: opts.optional,
        },
      }
    ).step,
    nodesToBuildAndTransitive,
    { pkgsToRebuild: ctx.pkgsToRebuild }
  );

  const nodesToBuildAndTransitiveArray = Array.from(nodesToBuildAndTransitive);

  for (const depPath of nodesToBuildAndTransitiveArray) {
    const pkgSnapshot = pkgSnapshots[depPath];

    graph.set(
      depPath,
      Object.entries({
        ...pkgSnapshot?.dependencies,
        ...pkgSnapshot?.optionalDependencies,
      })
        .map(([pkgName, reference]) => dp.refToRelative(reference, pkgName))
        .filter(Boolean)
        .filter((childRelDepPath): boolean => {
          return nodesToBuildAndTransitive.has(childRelDepPath);
        })
    );
  }

  const graphSequencerResult = graphSequencer(
    graph,
    nodesToBuildAndTransitiveArray
  );

  const chunks = graphSequencerResult.chunks as DepPath[][];

  function warn(message: string): void {
    logger.info({ message, prefix: opts.dir });
  }

  const ignoredPkgs: string[] = [];

  // TODO: @pnpm/builder.policy
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // Argument of type 'StrictRebuildOptions<T>' is not assignable to parameter of type '{ neverBuiltDependencies?: string[]; onlyBuiltDependencies?: string[]; onlyBuiltDependenciesFile?: string; }' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
  // Types of property 'neverBuiltDependencies' are incompatible.
  // Type 'string[] | undefined' is not assignable to type 'string[]'.
  // Type 'undefined' is not assignable to type 'string[]'.ts(2379)
  const _allowBuild = createAllowBuildFunction(opts) ?? (() => true);

  const allowBuild = (pkgName: string): boolean => {
    if (_allowBuild(pkgName) === true) {
      return true;
    }
    ignoredPkgs.push(pkgName);
    return false;
  };

  const builtDepPaths = new Set<string>();

  const groups = chunks.map((chunk) =>
    chunk
      .filter((depPath: DepPath): boolean => {
        return ctx.pkgsToRebuild.has(depPath) && !ctx.skipped.has(depPath);
      })
      .map((depPath: DepPath) => async (): Promise<void> => {
        const pkgSnapshot = pkgSnapshots[depPath];

        if (typeof pkgSnapshot === 'undefined') {
          return;
        }

        const pkgInfo = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

        const pkgRoots =
          opts.nodeLinker === 'hoisted'
            ? (ctx.modulesFile?.hoistedLocations?.[depPath] ?? []).map(
                (hoistedLocation: string): string => {
                  return path.join(opts.lockfileDir, hoistedLocation);
                }
              )
            : [
                path.join(
                  ctx.virtualStoreDir,
                  dp.depPathToFilename(depPath, opts.virtualStoreDirMaxLength),
                  'node_modules',
                  pkgInfo.name
                ),
              ];

        if (pkgRoots.length === 0) {
          if (pkgSnapshot.optional === true) {
            return;
          }

          throw new PnpmError(
            'MISSING_HOISTED_LOCATIONS',
            `${depPath} is not found in hoistedLocations inside node_modules/.modules.yaml`,
            {
              hint: 'If you installed your node_modules with pnpm older than v7.19.0, you may need to remove it and run "pnpm install"',
            }
          );
        }

        const pkgRoot = pkgRoots[0];

        if (typeof pkgRoot === 'undefined') {
          return;
        }

        try {
          const extraBinPaths = ctx.extraBinPaths;

          if (opts.nodeLinker === 'hoisted') {
            extraBinPaths.push(
              ...binDirsInAllParentDirs(pkgRoot, opts.lockfileDir)
            );
          } else {
            const modules = path.join(
              ctx.virtualStoreDir,
              dp.depPathToFilename(depPath, opts.virtualStoreDirMaxLength),
              'node_modules'
            ) as ModulesDir;

            const binPath = path.join(pkgRoot, 'node_modules', '.bin');

            await linkBins(modules, binPath, {
              extraNodePaths: ctx.extraNodePaths,
              warn,
            });
          }

          const resolution = pkgSnapshot.resolution;

          let sideEffectsCacheKey: string | undefined;

          const pkgId = `${pkgInfo.name}@${pkgInfo.version}`;

          if (
            opts.skipIfHasSideEffectsCache === true &&
            typeof resolution?.integrity === 'string'
          ) {
            const filesIndexFile = getIndexFilePathInCafs(
              opts.storeDir,
              resolution.integrity.toString(),
              pkgId
            );

            const pkgFilesIndex =
              await loadJsonFile<PackageFilesIndex>(filesIndexFile);

            sideEffectsCacheKey = calcDepState(
              depGraph,
              depsStateCache,
              depPath,
              {
                isBuilt: true,
              }
            );

            if (pkgFilesIndex.sideEffects?.[sideEffectsCacheKey]) {
              pkgsThatWereRebuilt.add(depPath);
              return;
            }
          }

          const hasSideEffects =
            allowBuild(pkgInfo.name) &&
            (await runPostinstallHooks({
              depPath,
              extraBinPaths,
              extraEnv: opts.extraEnv,
              optional: pkgSnapshot.optional === true,
              pkgRoot,
              rawConfig: opts.rawConfig,
              rootModulesDir: ctx.rootModulesDir,
              scriptsPrependNodePath: opts.scriptsPrependNodePath,
              shellEmulator: opts.shellEmulator,
              unsafePerm: opts.unsafePerm ?? false,
            }));
          if (
            hasSideEffects &&
            (opts.sideEffectsCacheWrite ?? true) &&
            typeof resolution?.integrity === 'string'
          ) {
            builtDepPaths.add(depPath);

            const filesIndexFile = getIndexFilePathInCafs(
              opts.storeDir,
              resolution.integrity.toString(),
              pkgId
            );

            try {
              if (typeof sideEffectsCacheKey === 'undefined') {
                sideEffectsCacheKey = calcDepState(
                  depGraph,
                  depsStateCache,
                  depPath,
                  {
                    isBuilt: true,
                  }
                );
              }

              await opts.storeController?.upload(pkgRoot, {
                sideEffectsCacheKey,
                filesIndexFile,
              });
            } catch (err: unknown) {
              assert(util.types.isNativeError(err));

              if ('statusCode' in err && err.statusCode === 403) {
                logger.warn({
                  message: `The store server disabled upload requests, could not upload ${pkgRoot}`,
                  prefix: opts.lockfileDir,
                });
              } else {
                logger.warn({
                  error: err,
                  message: `An error occurred while uploading ${pkgRoot}`,
                  prefix: opts.lockfileDir,
                });
              }
            }
          }

          pkgsThatWereRebuilt.add(depPath);
        } catch (err: unknown) {
          assert(util.types.isNativeError(err));

          if (pkgSnapshot.optional === true) {
            // TODO: add parents field to the log
            skippedOptionalDependencyLogger.debug({
              details: err.toString(),
              package: {
                id: pkgSnapshot.id ?? depPath,
                name: pkgInfo.name,
                version: pkgInfo.version,
              },
              prefix: opts.dir,
              reason: 'build_failure',
            });

            return;
          }

          throw err;
        }

        if (pkgRoots.length > 1) {
          await hardLinkDir(pkgRoot, pkgRoots.slice(1));
        }
      })
  );

  await runGroups.default(opts.childConcurrency || 5, groups);

  if (builtDepPaths.size > 0) {
    // It may be optimized because some bins were already linked before running lifecycle scripts
    await Promise.all(
      (Object.keys(pkgSnapshots) as DepPath[])
        .filter((depPath: DepPath): boolean => {
          return (
            typeof pkgSnapshots[depPath] === 'undefined' ||
            !packageIsIndependent(pkgSnapshots[depPath])
          );
        })
        .map(async (depPath: DepPath): Promise<string[]> => {
          return limitLinking(async (): Promise<string[]> => {
            const pkgSnapshot = pkgSnapshots[depPath];

            if (typeof pkgSnapshot === 'undefined') {
              return [];
            }

            const pkgInfo = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

            const modules = path.join(
              ctx.virtualStoreDir,
              dp.depPathToFilename(depPath, opts.virtualStoreDirMaxLength),
              'node_modules'
            ) as ModulesDir;

            const binPath = path.join(
              modules,
              pkgInfo.name,
              'node_modules',
              '.bin'
            );
            return linkBins(modules, binPath, { warn });
          });
        })
    );
    await Promise.all(
      Object.values(ctx.projects).map(
        async ({
          rootDir,
        }: {
          id: ProjectId;
          rootDir:
            | WorkspaceDir
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | LockFileDir;
        }): Promise<string[]> => {
          return limitLinking(async (): Promise<string[]> => {
            const modules = path.join(rootDir, 'node_modules') as ModulesDir;

            const binPath = path.join(modules, '.bin');

            return linkBins(modules, binPath, {
              allowExoticManifests: true,
              warn,
            });
          });
        }
      )
    );
  }

  return { pkgsThatWereRebuilt, ignoredPkgs };
}

function binDirsInAllParentDirs(
  pkgRoot: string,
  lockfileDir?: LockFileDir | undefined
): string[] {
  const binDirs: string[] = [];
  let dir = pkgRoot;
  do {
    if (!(path.dirname(dir)[0] === '@')) {
      binDirs.push(path.join(dir, 'node_modules/.bin'));
    }
    dir = path.dirname(dir);
  } while (path.relative(dir, lockfileDir ?? '') !== '');
  binDirs.push(path.join(lockfileDir ?? '', 'node_modules/.bin'));
  return binDirs;
}
