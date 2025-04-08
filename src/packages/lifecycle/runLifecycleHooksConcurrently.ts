import fs from 'node:fs';
import { linkBins } from '../link-bins/index.ts';
import { logger } from '../logger/index.ts';
import path from 'node:path';
import { fetchFromDir } from '../directory-fetcher/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  ModulesDir,
  ProjectManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import runGroups from 'run-groups';
import {
  runLifecycleHook,
  type RunLifecycleHookOptions,
} from './runLifecycleHook.ts';

export type RunLifecycleHooksConcurrentlyOptions = Omit<
  RunLifecycleHookOptions,
  'depPath' | 'pkgRoot' | 'rootModulesDir'
> & {
  resolveSymlinksInInjectedDirs?: boolean | undefined;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  extraNodePaths?: string[] | undefined;
  preferSymlinkedExecutables?: boolean | undefined;
};

export interface Importer {
  buildIndex?: number | undefined;
  manifest?: ProjectManifest | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  modulesDir?: ModulesDir | undefined;
  stages?: string[] | undefined;
  targetDirs?: string[] | undefined;
}

export async function runLifecycleHooksConcurrently(
  stages: string[],
  importers: Importer[],
  childConcurrency: number,
  opts: RunLifecycleHooksConcurrentlyOptions
): Promise<void> {
  const importersByBuildIndex = new Map<number, Importer[]>();

  for (const importer of importers) {
    if (typeof importer.buildIndex === 'number') {
      if (importersByBuildIndex.has(importer.buildIndex)) {
        importersByBuildIndex.get(importer.buildIndex)?.push(importer);
      } else {
        importersByBuildIndex.set(importer.buildIndex, [importer]);
      }
    }
  }

  const sortedBuildIndexes = Array.from(importersByBuildIndex.keys()).sort(
    (a: number, b: number): number => {
      return a - b;
    }
  );

  const groups = sortedBuildIndexes.map(
    (buildIndex: number): Array<() => Promise<void>> => {
      const importers = importersByBuildIndex.get(buildIndex);

      return (
        importers?.map(
          ({
            manifest,
            modulesDir,
            rootDir,
            stages: importerStages,
            targetDirs,
          }: Importer): (() => Promise<void>) => {
            return async (): Promise<void> => {
              // We are linking the bin files, in case they were created by lifecycle scripts of other workspace packages.
              await linkBins(
                modulesDir ?? ('node_modules' as ModulesDir),
                path.join(modulesDir ?? '', '.bin'),
                {
                  extraNodePaths: opts.extraNodePaths,
                  allowExoticManifests: true,
                  preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
                  projectManifest: manifest,
                  warn: (message: string): void => {
                    logger.warn({ message, prefix: rootDir });
                  },
                }
              );

              const runLifecycleHookOpts: RunLifecycleHookOptions = {
                ...opts,
                depPath: rootDir,
                pkgRoot: rootDir,
                rootModulesDir: modulesDir,
              };

              let isBuilt = false;

              for (const stage of importerStages ?? stages) {
                if (
                  typeof manifest !== 'undefined' &&
                  (await runLifecycleHook(
                    stage,
                    manifest,
                    runLifecycleHookOpts
                  ))
                ) {
                  isBuilt = true;
                }
              }

              if (targetDirs == null || targetDirs.length === 0 || !isBuilt) {
                return;
              }

              const filesResponse = await fetchFromDir(rootDir, {
                resolveSymlinks: opts.resolveSymlinksInInjectedDirs,
              });

              await Promise.all(
                targetDirs.map(async (targetDir) => {
                  const targetModulesDir = path.join(
                    targetDir,
                    'node_modules'
                  ) as ModulesDir;

                  const nodeModulesIndex = {};

                  if (fs.existsSync(targetModulesDir)) {
                    // If the target directory contains a node_modules directory
                    // (it may happen when the hoisted node linker is used)
                    // then we need to preserve this node_modules.
                    // So we scan this node_modules directory and  pass it as part of the new package.
                    await scanDir(
                      'node_modules',
                      targetModulesDir,
                      targetModulesDir,
                      nodeModulesIndex
                    );
                  }

                  return opts.storeController.importPackage(targetDir, {
                    filesResponse: {
                      unprocessed: false,
                      resolvedFrom: 'local-dir',
                      ...filesResponse,
                      filesIndex: {
                        ...filesResponse.filesIndex,
                        ...nodeModulesIndex,
                      },
                    },
                    force: false,
                  });
                })
              );
            };
          }
        ) ?? []
      );
    }
  );

  await runGroups.default(childConcurrency, groups);
}

async function scanDir(
  prefix: string,
  modulesDir: ModulesDir,
  currentDir: string,
  index: Record<string, string>
): Promise<void> {
  const files = await fs.promises.readdir(currentDir);

  await Promise.all(
    files.map(async (file: string): Promise<void> => {
      const fullPath = path.join(currentDir, file);

      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        return scanDir(prefix, modulesDir, fullPath, index);
      }

      if (stat.isFile()) {
        const relativePath = path.relative(modulesDir, fullPath);

        index[path.join(prefix, relativePath)] = fullPath;
      }
    })
  );
}
