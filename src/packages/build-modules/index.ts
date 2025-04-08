import assert from 'node:assert';
import path from 'node:path';
import util from 'node:util';
import { calcDepState, type DepsStateCache } from '../calc-dep-state/index.ts';
import {
  skippedOptionalDependencyLogger,
  ignoredScriptsLogger,
} from '../core-loggers/index.ts';
import { runPostinstallHooks } from '../lifecycle/index.ts';
import { linkBins, linkBinsOfPackages } from '../link-bins/index.ts';
import { logger } from '../logger/index.ts';
import { hardLinkDir } from '../worker/index.ts';
import {
  readPackageJsonFromDir,
  safeReadPackageJsonFromDir,
} from '../read-package-json/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import { applyPatchToDir } from '../patching.apply-patch/index.ts';
import pDefer, { type DeferredPromise } from 'p-defer';
import pickBy from 'ramda/src/pickBy';
import runGroups from 'run-groups';
import {
  buildSequence,
  type DependenciesGraph,
  type DependenciesGraphNode,
} from './buildSequence.ts';
import type { ModulesDir, PackageManifest } from '../types/index.ts';

export type { DepsStateCache };

export async function buildModules<T extends string, IP>(
  depGraph: DependenciesGraph<T>,
  rootDepPaths: T[],
  opts: {
    allowBuild?: ((pkgName: string) => boolean) | undefined;
    ignoredBuiltDependencies?: string[] | undefined;
    childConcurrency?: number | undefined;
    depsToBuild?: Set<string> | undefined;
    depsStateCache: DepsStateCache;
    extraBinPaths?: string[] | undefined;
    extraNodePaths?: string[] | undefined;
    extraEnv?: Record<string, string> | undefined;
    ignoreScripts?: boolean;
    lockfileDir: string;
    optional: boolean;
    preferSymlinkedExecutables?: boolean | undefined;
    rawConfig: object;
    unsafePerm: boolean;
    userAgent: string;
    scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
    scriptShell?: string | undefined;
    shellEmulator?: boolean | undefined;
    sideEffectsCacheWrite: boolean;
    storeController: StoreController<PackageResponse, PackageResponse, IP>;
    rootModulesDir: string;
    hoistedLocations?: Record<string, string[]> | undefined;
  }
): Promise<{ ignoredBuilds?: string[] | undefined }> {
  if (!rootDepPaths.length) {
    return {};
  }

  function warn(message: string): void {
    logger.warn({ message, prefix: opts.lockfileDir });
  }

  // postinstall hooks

  const buildDepOpts = {
    ...opts,
    builtHoistedDeps: opts.hoistedLocations ? {} : undefined,
    warn,
  };

  const chunks = buildSequence<T>(depGraph, rootDepPaths);

  if (!chunks.length) {
    return {};
  }

  const ignoredPkgs = new Set<string>();

  const allowBuild =
    opts.allowBuild ??
    ((): boolean => {
      return true;
    });

  const groups = chunks.map((chunk: string[]): (() => Promise<void>)[] => {
    let newChunk = chunk.filter((depPath: string): boolean => {
      const node = depGraph[depPath as T];

      return (
        (node.requiresBuild === true || node.patch != null) &&
        node.isBuilt !== true
      );
    });

    if (opts.depsToBuild != null) {
      newChunk = newChunk.filter((depPath: string): boolean => {
        return opts.depsToBuild?.has(depPath) === true;
      });
    }

    return newChunk.map((depPath: string): (() => Promise<void>) => {
      return (): Promise<void> => {
        let ignoreScripts = Boolean(buildDepOpts.ignoreScripts);

        if (!ignoreScripts) {
          if (
            depGraph[depPath as T].requiresBuild === true &&
            !allowBuild(depGraph[depPath as T].name)
          ) {
            ignoredPkgs.add(depGraph[depPath as T].name);

            ignoreScripts = true;
          }
        }

        return buildDependency(depPath, depGraph, {
          ...buildDepOpts,
          ignoreScripts,
        });
      };
    });
  });

  await runGroups.default(opts.childConcurrency ?? 4, groups);

  if (
    typeof opts.ignoredBuiltDependencies?.length === 'number' &&
    opts.ignoredBuiltDependencies.length > 0
  ) {
    for (const ignoredBuild of opts.ignoredBuiltDependencies) {
      // We already ignore the build of this dependency.
      // No need to report it.
      ignoredPkgs.delete(ignoredBuild);
    }
  }

  const packageNames = Array.from(ignoredPkgs);

  ignoredScriptsLogger.debug({ packageNames });

  return { ignoredBuilds: packageNames };
}

async function buildDependency<T extends string, IP>(
  depPath: T,
  depGraph: DependenciesGraph<T>,
  opts: {
    extraBinPaths?: string[] | undefined;
    extraNodePaths?: string[] | undefined;
    extraEnv?: Record<string, string> | undefined;
    depsStateCache: DepsStateCache;
    ignoreScripts?: boolean | undefined;
    lockfileDir: string;
    optional: boolean;
    preferSymlinkedExecutables?: boolean | undefined;
    rawConfig: object;
    rootModulesDir: string;
    scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
    scriptShell?: string | undefined;
    shellEmulator?: boolean | undefined;
    sideEffectsCacheWrite: boolean;
    storeController: StoreController<PackageResponse, PackageResponse, IP>;
    unsafePerm: boolean;
    hoistedLocations?: Record<string, string[]> | undefined;
    builtHoistedDeps?: Record<string, DeferredPromise<void>> | undefined;
    warn: (message: string) => void;
  }
): Promise<void> {
  const depNode = depGraph[depPath];
  if (
    typeof depNode.filesIndexFile === 'undefined' ||
    depNode.filesIndexFile === ''
  ) {
    return;
  }

  if (opts.builtHoistedDeps) {
    if (opts.builtHoistedDeps[depNode.depPath]) {
      await opts.builtHoistedDeps[depNode.depPath]?.promise;

      return;
    }

    opts.builtHoistedDeps[depNode.depPath] = pDefer();
  }

  try {
    await linkBinsOfDependencies(depNode, depGraph, opts);

    let isPatched = false;

    if (depNode.patch) {
      const { file, strict } = depNode.patch;
      isPatched = applyPatchToDir({
        allowFailure: !strict,
        patchedDir: depNode.dir,
        patchFilePath: file.path,
      });
    }

    const hasSideEffects =
      opts.ignoreScripts !== true &&
      (await runPostinstallHooks({
        depPath,
        extraBinPaths: opts.extraBinPaths,
        extraEnv: opts.extraEnv,
        initCwd: opts.lockfileDir,
        optional: depNode.optional,
        pkgRoot: depNode.dir,
        rawConfig: opts.rawConfig,
        rootModulesDir: opts.rootModulesDir,
        scriptsPrependNodePath: opts.scriptsPrependNodePath,
        scriptShell: opts.scriptShell,
        shellEmulator: opts.shellEmulator,
        unsafePerm: opts.unsafePerm || false,
      }));

    if ((isPatched || hasSideEffects) && opts.sideEffectsCacheWrite) {
      try {
        const sideEffectsCacheKey = calcDepState(
          depGraph,
          opts.depsStateCache,
          depPath,
          {
            patchFileHash: depNode.patch?.file.hash,
            isBuilt: hasSideEffects,
          }
        );

        await opts.storeController.upload(depNode.dir, {
          sideEffectsCacheKey,
          filesIndexFile: depNode.filesIndexFile,
        });
      } catch (err: unknown) {
        assert(util.types.isNativeError(err));
        if ('statusCode' in err && err.statusCode === 403) {
          logger.warn({
            message: `The store server disabled upload requests, could not upload ${depNode.dir}`,
            prefix: opts.lockfileDir,
          });
        } else {
          logger.warn({
            error: err,
            message: `An error occurred while uploading ${depNode.dir}`,
            prefix: opts.lockfileDir,
          });
        }
      }
    }
  } catch (err: unknown) {
    assert(util.types.isNativeError(err));

    if (depNode.optional === true) {
      // TODO: add parents field to the log
      const pkg = await readPackageJsonFromDir(path.join(depNode.dir));

      skippedOptionalDependencyLogger.debug({
        details: err.toString(),
        package: {
          id: depNode.dir,
          name: pkg.name,
          version: pkg.version,
        },
        prefix: opts.lockfileDir,
        reason: 'build_failure',
      });

      return;
    }

    throw err;
  } finally {
    const hoistedLocationsOfDep = opts.hoistedLocations?.[depNode.depPath];

    if (hoistedLocationsOfDep) {
      // There is no need to build the same package in every location.
      // We just copy the built package to every location where it is present.
      const currentHoistedLocation = path.relative(
        opts.lockfileDir,
        depNode.dir
      );

      const nonBuiltHoistedDeps = hoistedLocationsOfDep.filter(
        (hoistedLocation: string): boolean => {
          return hoistedLocation !== currentHoistedLocation;
        }
      );

      await hardLinkDir(depNode.dir, nonBuiltHoistedDeps);
    }

    if (opts.builtHoistedDeps) {
      opts.builtHoistedDeps[depNode.depPath]?.resolve();
    }
  }
}

export async function linkBinsOfDependencies<T extends string>(
  depNode: DependenciesGraphNode<T>,
  depGraph: DependenciesGraph<T>,
  opts: {
    extraNodePaths?: string[] | undefined;
    optional?: boolean | undefined;
    preferSymlinkedExecutables?: boolean | undefined;
    warn: (message: string) => void;
  }
): Promise<void> {
  const childrenToLink: Record<string, T> =
    opts.optional === true
      ? depNode.children
      : pickBy.default((_child, childAlias: string): boolean => {
          return depNode.optionalDependencies.has(childAlias) !== true;
        }, depNode.children);

  const binPath = path.join(depNode.dir, 'node_modules/.bin');

  const pkgNodes = [
    ...Object.entries(childrenToLink)
      .map(
        ([alias, childDepPath]: [string, T]): {
          alias: string;
          dep: DependenciesGraph<T>[T];
        } => {
          return { alias, dep: depGraph[childDepPath] };
        }
      )
      .filter(
        ({
          alias,
          dep,
        }: {
          alias: string;
          dep: DependenciesGraph<T>[T];
        }): boolean => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
          if (!dep) {
            // TODO: Try to reproduce this issue with a test in @pnpm/core
            logger.debug({
              message: `Failed to link bins of "${alias}" to "${binPath}". This is probably not an issue.`,
            });

            return false;
          }

          return dep.hasBin && dep.installable !== false;
        }
      )
      .map(
        ({
          dep,
        }: {
          alias: string;
          dep: DependenciesGraph<T>[T];
        }): DependenciesGraph<T>[T] => {
          return dep;
        }
      ),
    depNode,
  ];

  const pkgs = (
    await Promise.all(
      pkgNodes.map(
        async (
          dep: DependenciesGraphNode<T>
        ): Promise<{
          location: string;
          manifest?: PackageManifest | undefined;
        }> => {
          return {
            location: dep.dir,
            manifest:
              (await dep.fetchingBundledManifest?.()) ??
              (await safeReadPackageJsonFromDir(dep.dir)) ??
              undefined,
          };
        }
      )
    )
  ).filter((pkg): pkg is { location: string; manifest: PackageManifest } => {
    return typeof pkg.manifest !== 'undefined';
  });

  await linkBinsOfPackages(pkgs, binPath, {
    extraNodePaths: opts.extraNodePaths,
    preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
  });

  // link also the bundled dependencies` bins
  if (depNode.hasBundledDependencies) {
    const bundledModules = path.join(depNode.dir, 'node_modules') as ModulesDir;

    await linkBins(bundledModules, binPath, {
      extraNodePaths: opts.extraNodePaths,
      preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
      warn: opts.warn,
    });
  }
}
