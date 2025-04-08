import assert from 'node:assert';
import util from 'node:util';
import {
  type RecursiveSummary,
  throwOnCommandFail,
} from '../cli-utils/index.ts';
import { type Config, readLocalConfig } from '../config/index.ts';
import { logger } from '../logger/index.ts';
import { sortPackages } from '../sort-packages/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type {
  ModulesDir,
  Project,
  ProjectId,
  ProjectManifest,
  ProjectRootDir,
} from '../types/index.ts';
import mem from 'mem';
import pLimit from 'p-limit';
import {
  rebuildProjects as rebuildAll,
  type RebuildOptions,
  rebuildSelectedPkgs,
} from './implementation/index.ts';
import { join } from 'node:path';
import type { ProjectOptions, HookOptions } from '../get-context/index.ts';

type RecursiveRebuildOpts = CreateStoreControllerOptions &
  Pick<
    Config,
    | 'hoistPattern'
    | 'hooks'
    | 'ignorePnpmfile'
    | 'ignoreScripts'
    | 'lockfileDir'
    | 'lockfileOnly'
    | 'nodeLinker'
    | 'rawLocalConfig'
    | 'registries'
    | 'rootProjectManifest'
    | 'rootProjectManifestDir'
    | 'sharedWorkspaceLockfile'
  > & {
    pending?: boolean | undefined;
  } & Partial<Pick<Config, 'bail' | 'sort' | 'workspaceConcurrency'>>;

export async function recursiveRebuild(
  allProjects: Project[],
  params: string[],
  opts: RecursiveRebuildOpts & {
    ignoredPackages?: Set<string> | undefined;
  } & Required<Pick<Config, 'selectedProjectsGraph' | 'workspaceDir'>>
): Promise<void> {
  if (allProjects.length === 0) {
    // It might make sense to throw an exception in this case
    return;
  }

  const pkgs = Object.values(opts.selectedProjectsGraph ?? {}).map(
    (wsPkg) => wsPkg.package
  );

  if (pkgs.length === 0) {
    return;
  }

  const manifestsByPath: {
    [dir: string]: Omit<Project, 'rootDir' | 'rootDirRealPath'>;
  } = {};

  for (const { rootDir, manifest, writeProjectManifest } of pkgs) {
    manifestsByPath[rootDir] = { manifest, writeProjectManifest };
  }

  const throwOnFail = throwOnCommandFail.bind(null, 'pnpm recursive rebuild');

  const chunks =
    opts.sort === true
      ? sortPackages(opts.selectedProjectsGraph ?? {})
      : [
          Object.keys(
            opts.selectedProjectsGraph ?? {}
          ).sort() as ProjectRootDir[],
        ];

  const store = await createOrConnectStoreController(opts);

  const rebuildOpts: RebuildOptions<{
    isBuilt: boolean;
    importMethod?: string | undefined;
  }> = Object.assign(opts, {
    ownLifecycleHooksStdio: 'pipe',
    pruneLockfileImporters:
      (opts.ignoredPackages == null || opts.ignoredPackages.size === 0) &&
      pkgs.length === allProjects.length,
    storeController: store.ctrl,
    storeDir: store.dir,
    lockfileDir: opts.lockfileDir,
  });

  const result: RecursiveSummary = {};

  const memReadLocalConfig = mem(readLocalConfig);

  async function getImporters(): Promise<
    (ProjectOptions & HookOptions & { binsDir: string })[]
  > {
    const importers: Array<ProjectOptions & HookOptions & { binsDir: string }> =
      [];

    await Promise.all(
      chunks.map(
        async (
          prefixes: ProjectRootDir[],
          buildIndex: number
        ): Promise<number[]> => {
          let newPrefixes = prefixes;

          if (typeof opts.ignoredPackages !== 'undefined') {
            newPrefixes = newPrefixes.filter((prefix: string): boolean => {
              return opts.ignoredPackages?.has(prefix) !== true;
            });
          }

          return Promise.all(
            newPrefixes.map(async (prefix: ProjectRootDir): Promise<number> => {
              return importers.push({
                id: '' as ProjectId,
                // TODO: fix binsDir
                binsDir: '',
                buildIndex,
                manifest: manifestsByPath[prefix]?.manifest as ProjectManifest,
                rootDir: prefix,
                modulesDir: join(prefix, 'node_modules') as ModulesDir,
              });
            })
          );
        }
      )
    );

    return importers;
  }

  const rebuild =
    params.length === 0
      ? rebuildAll
      : (
          importers: Array<
            ProjectOptions &
              HookOptions & {
                binsDir: string;
              }
          >,
          opts: RebuildOptions<{
            isBuilt: boolean;
            importMethod?: string | undefined;
          }>
        ) => {
          return rebuildSelectedPkgs<{
            isBuilt: boolean;
            importMethod?: string | undefined;
          }>(importers, params, opts);
        };

  if (typeof opts.lockfileDir === 'string' && opts.lockfileDir !== '') {
    const importers = await getImporters();

    await rebuild(importers, {
      ...rebuildOpts,
      pending: opts.pending === true,
    });

    return;
  }

  const limitRebuild = pLimit(opts.workspaceConcurrency ?? 4);

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (rootDir: ProjectRootDir): Promise<void> => {
        return limitRebuild(async (): Promise<void> => {
          try {
            if (opts.ignoredPackages?.has(rootDir) === true) {
              return;
            }

            result[rootDir] = { status: 'running' };

            const localConfig = await memReadLocalConfig(rootDir);

            await rebuild(
              [
                {
                  // TODO: fix id
                  id: '' as ProjectId,
                  // TODO: fix binsDir
                  binsDir: '',
                  buildIndex: 0,
                  // TODO: fix as
                  manifest: manifestsByPath[rootDir]
                    ?.manifest as ProjectManifest,
                  rootDir,
                  modulesDir: join(rootDir, 'node_modules') as ModulesDir,
                },
              ],
              {
                ...rebuildOpts,
                ...localConfig,
                dir: rootDir,
                pending: opts.pending === true,
                rawConfig: {
                  ...rebuildOpts.rawConfig,
                  ...localConfig,
                },
              }
            );

            result[rootDir] = {
              ...result[rootDir],
              status: 'passed',
            };
          } catch (err: unknown) {
            assert(util.types.isNativeError(err));

            const errWithPrefix = Object.assign(err, {
              prefix: rootDir,
            });

            logger.info(errWithPrefix);

            if (opts.bail !== true) {
              result[rootDir] = {
                status: 'failure',
                error: errWithPrefix,
                message: err.message,
                prefix: rootDir,
              };
              return;
            }

            throw err;
          }
        });
      })
    );
  }

  throwOnFail(result);
}
