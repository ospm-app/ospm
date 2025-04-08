import path from 'node:path';
import { calcDepState, type DepsStateCache } from '../calc-dep-state/index.ts';
import {
  progressLogger,
  removalLogger,
  statsLogger,
} from '../core-loggers/index.ts';
import type {
  DepHierarchy,
  DependenciesGraph,
} from '../deps.graph-builder/index.ts';
import { linkBins } from '../link-bins/index.ts';
import { logger } from '../logger/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import pLimit from 'p-limit';
import difference from 'ramda/src/difference';
import isEmpty from 'ramda/src/isEmpty';
import rimraf from '@zkochan/rimraf';
import type { PackageFilesResponse } from '../cafs-types/index.ts';
import type { ModulesDir } from '../types/project.ts';

const limitLinking = pLimit(16);

export async function linkHoistedModules(
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      importMethod?: string | undefined;
      isBuilt: boolean;
    }
  >,
  graph: DependenciesGraph,
  prevGraph: DependenciesGraph,
  hierarchy: DepHierarchy,
  opts: {
    allowBuild?: ((pkgName: string) => boolean) | undefined;
    depsStateCache: DepsStateCache;
    disableRelinkLocalDirDeps?: boolean | undefined;
    force: boolean;
    ignoreScripts: boolean;
    lockfileDir: string;
    preferSymlinkedExecutables?: boolean | undefined;
    sideEffectsCacheRead: boolean;
  }
): Promise<void> {
  // TODO: remove nested node modules first
  const dirsToRemove = difference.default(
    Object.keys(prevGraph),
    Object.keys(graph)
  );

  statsLogger.debug({
    prefix: opts.lockfileDir,
    removed: dirsToRemove.length,
  });

  // We should avoid removing unnecessary directories while simultaneously adding new ones.
  // Doing so can sometimes lead to a race condition when linking commands to `node_modules/.bin`.
  await Promise.all(dirsToRemove.map((dir) => tryRemoveDir(dir)));

  await Promise.all(
    Object.entries(hierarchy).map(([parentDir, depsHierarchy]) => {
      function warn(message: string): void {
        logger.info({
          message,
          prefix: parentDir,
        });
      }

      return linkAllPkgsInOrder(
        storeController,
        graph,
        depsHierarchy,
        parentDir,
        {
          ...opts,
          warn,
        }
      );
    })
  );
}

async function tryRemoveDir(dir: string): Promise<void> {
  removalLogger.debug(dir);
  try {
    await rimraf(dir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    /* Just ignoring for now. Not even logging.
    logger.warn({
      error: err,
      message: `Failed to remove "${pathToRemove}"`,
      prefix: lockfileDir,
    })
    */
  }
}

async function linkAllPkgsInOrder<R>(
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      importMethod?: string | undefined;
      isBuilt: boolean;
    }
  >,
  graph: DependenciesGraph,
  hierarchy: DepHierarchy,
  parentDir: string,
  opts: {
    allowBuild?: ((pkgName: string) => boolean) | undefined;
    depsStateCache: DepsStateCache;
    disableRelinkLocalDirDeps?: boolean | undefined;
    force: boolean;
    ignoreScripts: boolean;
    lockfileDir: string;
    preferSymlinkedExecutables?: boolean | undefined;
    sideEffectsCacheRead: boolean;
    warn: (message: string) => void;
  }
): Promise<void> {
  const _calcDepState = calcDepState.bind(null, graph, opts.depsStateCache);

  await Promise.all(
    Object.entries(hierarchy).map(
      async ([dir, deps]: [string, DepHierarchy]): Promise<void> => {
        const depNode = graph[dir];

        if (typeof depNode?.fetching === 'function') {
          let filesResponse!: PackageFilesResponse;

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
              sideEffectsCacheKey = _calcDepState(dir, {
                isBuilt: !opts.ignoreScripts && depNode.requiresBuild,
                patchFileHash: depNode.patch?.file.hash,
              });
            }
          }

          // Limiting the concurrency here fixes an out of memory error.
          // It is not clear why it helps as importing is also limited inside fs.indexed-pkg-importer.
          // The out of memory error was reproduced on the teambit/bit repository with the "rootComponents" feature turned on
          await limitLinking(async (): Promise<void> => {
            const { importMethod, isBuilt } =
              await storeController.importPackage(depNode.dir, {
                filesResponse,
                force: true,
                disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
                keepModulesDir: true,
                requiresBuild: depNode.patch != null || depNode.requiresBuild,
                sideEffectsCacheKey,
              });

            if (typeof importMethod !== 'undefined') {
              progressLogger.debug({
                method: importMethod,
                requester: opts.lockfileDir,
                status: 'imported',
                to: depNode.dir,
              });
            }

            depNode.isBuilt = isBuilt;
          });
        }

        return linkAllPkgsInOrder<R>(storeController, graph, deps, dir, opts);
      }
    )
  );

  const modulesDir: ModulesDir = path.join(
    parentDir,
    'node_modules'
  ) as ModulesDir;

  const binsDir = path.join(modulesDir, '.bin');

  await linkBins(modulesDir, binsDir, {
    allowExoticManifests: true,
    preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
    warn: opts.warn,
  });
}
