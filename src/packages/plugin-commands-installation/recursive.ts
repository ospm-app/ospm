import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type RecursiveSummary,
  throwOnCommandFail,
} from '../cli-utils/index.ts';
import {
  type Config,
  getOptionsFromRootManifest,
  readLocalConfig,
} from '../config/index.ts';
import { PnpmError } from '../error/index.ts';
import {
  arrayOfWorkspacePackagesToMap,
  type HookOptions,
  type ProjectOptions,
} from '../get-context/index.ts';
import { logger } from '../logger/index.ts';
import { filterDependenciesByType } from '../manifest-utils/index.ts';
import { createMatcherWithIndex } from '../matcher/index.ts';
import { rebuild } from '../plugin-commands-rebuild/index.ts';
import type {
  ImportIndexedPackageAsync,
  PackageResponse,
  StoreController,
} from '../package-store/index.ts';
import { requireHooks } from '../pnpmfile/index.ts';
import { sortPackages } from '../sort-packages/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type {
  IncludedDependencies,
  PackageManifest,
  Project,
  ProjectManifest,
  ProjectsGraph,
  ProjectRootDir,
  ProjectRootDirRealPath,
  ProjectId,
  ModulesDir,
  GlobalPkgDir,
  WorkspaceDir,
  LockFileDir,
} from '../types/index.ts';
import type {
  InstallOptions,
  MutatedProjectInstall,
  MutatedProjectInstallSome,
  UpdateMatchingFunction,
  WorkspacePackages,
} from '../core/index.ts';
import isSubdir from 'is-subdir';
import mem from 'mem';
import pFilter from 'p-filter';
import pLimit from 'p-limit';
import {
  createWorkspaceSpecs,
  updateToWorkspacePackagesFromManifest,
} from './updateWorkspaceDependencies.js';
import { getSaveType } from './getSaveType.js';
import { getPinnedVersion } from './getPinnedVersion.js';
import type { PreferredVersions } from '../resolver-base/index.ts';
import { IgnoredBuildsError } from './errors.js';
import { install } from '@pnpm/tabtab';
import {
  mutateModules,
  type MutatedProject,
  addDependenciesToPackage,
  type UpdatedProject,
  type MutateModulesOptions,
} from '../core/install/index.ts';
import type { Log } from '../core-loggers/index.ts';
import type { CustomFetchers } from '../fetcher-base/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { PreResolutionHookContext } from '../hooks.types/index.ts';

export type RecursiveOptions = CreateStoreControllerOptions &
  Pick<
    Config,
    | 'bail'
    | 'configDependencies'
    | 'dedupePeerDependents'
    | 'depth'
    | 'globalPnpmfile'
    | 'hoistPattern'
    | 'hooks'
    | 'ignorePnpmfile'
    | 'ignoreScripts'
    | 'linkWorkspacePackages'
    | 'lockfileDir'
    | 'lockfileOnly'
    | 'modulesDir'
    | 'pnpmfile'
    | 'rawLocalConfig'
    | 'registries'
    | 'rootProjectManifest'
    | 'rootProjectManifestDir'
    | 'save'
    | 'saveDev'
    | 'saveExact'
    | 'saveOptional'
    | 'savePeer'
    | 'savePrefix'
    | 'saveProd'
    | 'saveWorkspaceProtocol'
    | 'lockfileIncludeTarballUrl'
    | 'sharedWorkspaceLockfile'
    | 'tag'
  > & {
    include?: IncludedDependencies | undefined;
    includeDirect?: IncludedDependencies | undefined;
    latest?: boolean | undefined;
    pending?: boolean | undefined;
    workspace?: boolean | undefined;
    allowNew?: boolean | undefined;
    forceHoistPattern?: boolean | undefined;
    forcePublicHoistPattern?: boolean | undefined;
    ignoredPackages?: Set<string> | undefined;
    update?: boolean | undefined;
    updatePackageManifest?: boolean | undefined;
    updateMatching?: UpdateMatchingFunction | undefined;
    useBetaCli?: boolean | undefined;
    allProjectsGraph?: ProjectsGraph | undefined;
    selectedProjectsGraph: ProjectsGraph;
    preferredVersions?: PreferredVersions | undefined;
    pruneDirectDependencies?: boolean | undefined;
    storeControllerAndDir?:
      | {
          ctrl: StoreController<
            PackageResponse,
            PackageResponse,
            {
              isBuilt: boolean;
              importMethod?: string | undefined;
            }
          >;
          dir: string;
        }
      | undefined;
  } & Partial<
    Pick<Config, 'sort' | 'strictDepBuilds' | 'workspaceConcurrency'>
  > &
  Required<Pick<Config, 'workspaceDir'>>;

export type CommandFullName =
  | 'install'
  | 'add'
  | 'remove'
  | 'update'
  | 'import';

export async function recursive(
  allProjects: Project[],
  params: string[],
  opts: RecursiveOptions,
  cmdFullName: CommandFullName
): Promise<boolean | string> {
  let newParams = [...params];

  if (allProjects.length === 0) {
    // It might make sense to throw an exception in this case
    return false;
  }

  const pkgs = Object.values(opts.selectedProjectsGraph).map(
    (wsPkg) => wsPkg.package
  );

  if (pkgs.length === 0) {
    return false;
  }
  const manifestsByPath = getManifestsByPath(allProjects);

  const throwOnFail = throwOnCommandFail.bind(
    null,
    `pnpm recursive ${cmdFullName}`
  );

  const store =
    opts.storeControllerAndDir ?? (await createOrConnectStoreController(opts));

  const workspacePackages: WorkspacePackages =
    arrayOfWorkspacePackagesToMap(allProjects);

  const targetDependenciesField = getSaveType(opts);

  const rootManifestDir = opts.lockfileDir; // ?? opts.dir;

  const installOpts = Object.assign(opts, {
    ...getOptionsFromRootManifest(
      rootManifestDir,
      manifestsByPath[rootManifestDir]?.manifest
    ),
    allProjects: getAllProjects(
      manifestsByPath,
      opts.allProjectsGraph ?? {},
      opts.sort
    ),
    linkWorkspacePackagesDepth:
      opts.linkWorkspacePackages === 'deep'
        ? Number.POSITIVE_INFINITY
        : opts.linkWorkspacePackages
          ? 0
          : -1,
    ownLifecycleHooksStdio: 'pipe' as const,
    peer: opts.savePeer,
    pruneLockfileImporters:
      (opts.ignoredPackages == null || opts.ignoredPackages.size === 0) &&
      pkgs.length === allProjects.length,
    storeController: store.ctrl,
    storeDir: store.dir,
    targetDependenciesField,
    workspacePackages,

    forceHoistPattern:
      typeof opts.rawLocalConfig['hoist-pattern'] !== 'undefined' ||
      typeof opts.rawLocalConfig['hoist'] !== 'undefined',
    forceShamefullyHoist:
      typeof opts.rawLocalConfig['shamefully-hoist'] !== 'undefined',
  });

  const result: RecursiveSummary = {};

  const memReadLocalConfig = mem(readLocalConfig);

  const updateToLatest = opts.update === true && opts.latest === true;

  const includeDirect = opts.includeDirect ?? {
    dependencies: true,
    devDependencies: true,
    optionalDependencies: true,
  };

  let updateMatch: UpdateDepsMatcher | null;

  if (cmdFullName === 'update') {
    if (newParams.length === 0 && typeof opts.workspaceDir !== 'undefined') {
      const ignoreDeps =
        manifestsByPath[opts.workspaceDir]?.manifest.pnpm?.updateConfig
          ?.ignoreDependencies;

      if (typeof ignoreDeps?.length === 'number' && ignoreDeps.length > 0) {
        newParams = makeIgnorePatterns(ignoreDeps);
      }
    }
    updateMatch = newParams.length ? createMatcher(newParams) : null;
  } else {
    updateMatch = null;
  }

  // For a workspace with shared lockfile
  if (
    typeof opts.lockfileDir === 'string' &&
    typeof opts.workspaceDir === 'string' &&
    ['add', 'install', 'remove', 'update', 'import'].includes(cmdFullName)
  ) {
    let importers = getImporters(opts);

    const calculatedRepositoryRoot = await fs.realpath(
      calculateRepositoryRoot(
        opts.workspaceDir,
        importers.map(
          (
            x
          ):
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | WorkspaceDir => {
            return x.rootDir;
          }
        )
      )
    );

    const isFromWorkspace = isSubdir.bind(null, calculatedRepositoryRoot);

    importers = await pFilter(
      importers,
      async ({
        rootDirRealPath,
      }: {
        rootDir:
          | ProjectRootDir
          | ProjectRootDirRealPath
          | GlobalPkgDir
          | WorkspaceDir;
        rootDirRealPath?: ProjectRootDirRealPath | undefined;
      }): Promise<boolean> => {
        return (
          typeof rootDirRealPath === 'string' &&
          isFromWorkspace(rootDirRealPath)
        );
      }
    );

    if (importers.length === 0) {
      return true;
    }

    let mutation!: string;

    switch (cmdFullName) {
      case 'remove': {
        mutation = 'uninstallSome';
        break;
      }
      case 'import': {
        mutation = 'install';
        break;
      }
      default: {
        mutation =
          newParams.length === 0 && updateToLatest !== true
            ? 'install'
            : 'installSome';
        break;
      }
    }

    const mutatedImporters: (MutatedProject & {
      modulesDir?: ModulesDir | undefined;
    })[] = [];

    await Promise.all(
      importers.map(
        async ({
          rootDir,
        }: {
          rootDir:
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | WorkspaceDir
            | LockFileDir;
          rootDirRealPath?: ProjectRootDirRealPath | undefined;
        }): Promise<void> => {
          const localConfig = await memReadLocalConfig(rootDir);

          const modulesDir = localConfig.modulesDir ?? opts.modulesDir;

          const manifest = manifestsByPath[rootDir]?.manifest;

          if (typeof manifest === 'undefined') {
            return;
          }

          let currentInput = [...newParams];

          if (updateMatch != null) {
            currentInput = matchDependencies(
              updateMatch,
              manifest,
              includeDirect
            );
            if (
              currentInput.length === 0 &&
              (typeof opts.depth === 'undefined' || opts.depth <= 0)
            ) {
              installOpts.pruneLockfileImporters = false;
              return;
            }
          }
          if (updateToLatest && newParams.length === 0) {
            currentInput = Object.keys(
              filterDependenciesByType(manifest, includeDirect)
            );
          }

          if (opts.workspace === true) {
            if (currentInput.length === 0) {
              currentInput = updateToWorkspacePackagesFromManifest(
                manifest,
                includeDirect,
                workspacePackages
              );
            } else {
              currentInput = createWorkspaceSpecs(
                currentInput,
                workspacePackages
              );
            }
          }

          switch (mutation) {
            case 'uninstallSome': {
              const mp: MutatedProject & {
                modulesDir?: ModulesDir | undefined;
              } = {
                dependencyNames: currentInput,
                modulesDir,
                mutation,
                rootDir,
                targetDependenciesField,
              };

              mutatedImporters.push(mp);

              return;
            }

            case 'installSome': {
              const mp: MutatedProjectInstallSome & {
                modulesDir?: ModulesDir | undefined;
              } = {
                allowNew: cmdFullName === 'install' || cmdFullName === 'add',
                dependencySelectors: currentInput,
                modulesDir,
                mutation,
                peer: opts.savePeer,
                pinnedVersion: getPinnedVersion({
                  saveExact:
                    typeof localConfig.saveExact === 'boolean'
                      ? localConfig.saveExact
                      : opts.saveExact,
                  savePrefix:
                    typeof localConfig.savePrefix === 'string'
                      ? localConfig.savePrefix
                      : opts.savePrefix,
                }),
                rootDir,
                targetDependenciesField,
                update: opts.update,
                updateMatching: opts.updateMatching,
                updatePackageManifest: opts.updatePackageManifest,
                updateToLatest: opts.latest,
              };

              mutatedImporters.push(mp);

              return;
            }

            case 'install': {
              const mp: MutatedProjectInstall & {
                modulesDir?: ModulesDir | undefined;
              } = {
                modulesDir,
                mutation,
                pruneDirectDependencies: opts.pruneDirectDependencies,
                rootDir,
                update: opts.update,
                updateMatching: opts.updateMatching,
                updatePackageManifest: opts.updatePackageManifest,
                updateToLatest: opts.latest,
              };

              mutatedImporters.push(mp);
            }
          }
        }
      )
    );

    if (
      !opts.selectedProjectsGraph[opts.workspaceDir] &&
      typeof manifestsByPath[opts.workspaceDir] !== 'undefined'
    ) {
      const mp: MutatedProject = {
        mutation: 'install',
        rootDir: opts.workspaceDir,
        update: false,
      };

      mutatedImporters.push(mp);
    }

    if (
      mutatedImporters.length === 0 &&
      cmdFullName === 'update' &&
      opts.depth === 0
    ) {
      throw new PnpmError(
        'NO_PACKAGE_IN_DEPENDENCIES',
        'None of the specified packages were found in the dependencies of any of the projects.'
      );
    }

    const { updatedProjects: mutatedPkgs, ignoredBuilds } = await mutateModules(
      mutatedImporters,
      {
        ...installOpts,
        update: installOpts.update ?? opts.update ?? false,
        bin: '',
        include: installOpts.include ?? {
          dependencies: true,
          devDependencies: true,
          optionalDependencies: true,
        },
        includeDirect: installOpts.includeDirect ?? {
          dependencies: true,
          devDependencies: true,
          optionalDependencies: true,
        },
        ignoreScripts: installOpts.ignoreScripts ?? false,
        unsafePerm: installOpts.unsafePerm ?? false,
        dedupePeerDependents: installOpts.dedupePeerDependents ?? false,
        allowNonAppliedPatches: installOpts.allowNonAppliedPatches ?? false,
        tag: installOpts.tag ?? '',
        resolveSymlinksInInjectedDirs:
          installOpts.resolveSymlinksInInjectedDirs ?? false,
        resolutionMode: installOpts.resolutionMode ?? 'highest',
        overrides: installOpts.overrides ?? {},
        userAgent: installOpts.userAgent ?? 'pnpm',
        hooks: installOpts.hooks ?? {},
        allowedDeprecatedVersions: installOpts.allowedDeprecatedVersions ?? {},
        ignoredOptionalDependencies:
          installOpts.ignoredOptionalDependencies ?? [],
        packageExtensions: installOpts.packageExtensions ?? {},
        nodeVersion: installOpts.nodeVersion ?? '',
        depth: installOpts.depth ?? 0,
        ignorePnpmfile: installOpts.ignorePnpmfile ?? false,
        force: installOpts.force ?? false,
        engineStrict: installOpts.engineStrict ?? false,
        lockfileDir: installOpts.lockfileDir,
        modulesDir: installOpts.modulesDir ?? ('node_modules' as ModulesDir),
        forcePublicHoistPattern: installOpts.forcePublicHoistPattern ?? false,
        lockfileIncludeTarballUrl:
          installOpts.lockfileIncludeTarballUrl ?? false,
        saveWorkspaceProtocol: installOpts.saveWorkspaceProtocol ?? false,
        lockfileOnly: installOpts.lockfileOnly ?? false,
        storeDir: installOpts.storeDir,
        storeController: store.ctrl,
      }
    );

    if (opts.save !== false) {
      await Promise.all(
        mutatedPkgs.map(
          async ({
            originalManifest,
            manifest,
            rootDir,
          }: UpdatedProject): Promise<void> => {
            const m = originalManifest ?? manifest;
            const p = manifestsByPath[rootDir];

            if (typeof p === 'undefined' || typeof m === 'undefined') {
              return;
            }

            return p.writeProjectManifest(m);
          }
        )
      );
    }

    if (
      opts.strictDepBuilds === true &&
      typeof ignoredBuilds?.length === 'number' &&
      ignoredBuilds.length > 0
    ) {
      throw new IgnoredBuildsError(ignoredBuilds);
    }

    return true;
  }

  const pkgPaths = (
    Object.keys(opts.selectedProjectsGraph) as ProjectRootDir[]
  ).sort();

  const limitInstallation = pLimit(opts.workspaceConcurrency ?? 4);

  await Promise.all(
    pkgPaths.map(async (rootDir: ProjectRootDir): Promise<void> => {
      return limitInstallation(async (): Promise<void> => {
        const hooks =
          opts.ignorePnpmfile === true
            ? {}
            : ((): {
                afterAllResolved: ((
                  arg: LockfileObject,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ...otherArgs: any[]
                ) => LockfileObject | Promise<LockfileObject>)[];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                readPackage: ((arg: any, ...otherArgs: any[]) => any)[];
                preResolution?:
                  | ((
                      arg: PreResolutionHookContext,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      ...otherArgs: any[]
                    ) => Promise<void>)
                  | undefined;
                filterLog?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Array<(arg: Log, ...otherArgs: any[]) => boolean> | undefined;
                importPackage?: ImportIndexedPackageAsync | undefined;
                fetchers?: CustomFetchers | undefined;
                calculatePnpmfileChecksum?:
                  | (() => Promise<string | undefined>)
                  | undefined;
              } => {
                const pnpmfileHooks = requireHooks(rootDir, opts);

                return {
                  ...opts.hooks,
                  ...pnpmfileHooks,
                  afterAllResolved: [
                    ...(pnpmfileHooks.afterAllResolved ?? []),
                    ...(opts.hooks?.afterAllResolved ?? []),
                  ],
                  readPackage: [
                    ...(pnpmfileHooks.readPackage ?? []),
                    ...(opts.hooks?.readPackage ?? []),
                  ],
                };
              })();
        try {
          if (opts.ignoredPackages?.has(rootDir) === true) {
            return;
          }

          result[rootDir] = { status: 'running' };

          const m = manifestsByPath[rootDir];

          if (typeof m === 'undefined') {
            return;
          }

          const { manifest, writeProjectManifest } = m;

          let currentInput = [...params];

          if (updateMatch != null) {
            currentInput = matchDependencies(
              updateMatch,
              manifest,
              includeDirect
            );

            if (currentInput.length === 0) {
              return;
            }
          }

          if (updateToLatest && newParams.length === 0) {
            currentInput = Object.keys(
              filterDependenciesByType(manifest, includeDirect)
            );
          }

          if (opts.workspace === true) {
            if (currentInput.length === 0) {
              currentInput = updateToWorkspacePackagesFromManifest(
                manifest,
                includeDirect,
                workspacePackages
              );
            } else {
              currentInput = createWorkspaceSpecs(
                currentInput,
                workspacePackages
              );
            }
          }

          // let action:
          //   | ((
          //       _manifest: PackageManifest,
          //       opts: MutateModulesOptions
          //     ) => Promise<{
          //       updatedManifest?: ProjectManifest | undefined;
          //       ignoredBuilds?: string[] | undefined;
          //     }>)
          //   | ((options: {
          //       name: string;
          //       completer: string;
          //       shell?: 'bash' | 'fish' | 'pwsh' | 'zsh' | undefined;
          //     }) => Promise<void>)
          //   | undefined;

          const localConfig = await memReadLocalConfig(rootDir);

          switch (cmdFullName) {
            case 'remove': {
              const action = async (
                _manifest: PackageManifest,
                opts: MutateModulesOptions
              ): Promise<{
                updatedManifest?: ProjectManifest | undefined;
                ignoredBuilds: string[] | undefined;
              }> => {
                const mutationResult = await mutateModules(
                  [
                    {
                      dependencyNames: currentInput,
                      mutation: 'uninstallSome',
                      rootDir,
                    },
                  ],
                  opts
                );

                return {
                  updatedManifest: mutationResult.updatedProjects[0]?.manifest,
                  ignoredBuilds: mutationResult.ignoredBuilds,
                };
              };

              const rootOptions = getOptionsFromRootManifest(rootDir, manifest);

              const { updatedManifest: newManifest, ignoredBuilds } =
                await action(manifest, {
                  ...installOpts,
                  ...localConfig,
                  nodeVersion: installOpts.nodeVersion ?? '',
                  engineStrict: installOpts.engineStrict ?? false,
                  lockfileDir: installOpts.lockfileDir,
                  depth: installOpts.depth ?? 0,
                  forcePublicHoistPattern:
                    installOpts.forcePublicHoistPattern ?? false,
                  force: installOpts.force ?? false,
                  lockfileIncludeTarballUrl:
                    installOpts.lockfileIncludeTarballUrl ?? false,
                  saveWorkspaceProtocol:
                    installOpts.saveWorkspaceProtocol ?? false,
                  lockfileOnly: installOpts.lockfileOnly ?? false,
                  ...rootOptions,
                  ...opts.allProjectsGraph?.[rootDir]?.package,
                  allowedDeprecatedVersions:
                    rootOptions.allowedDeprecatedVersions ?? {},
                  allowNonAppliedPatches:
                    rootOptions.allowNonAppliedPatches ?? false,
                  resolveSymlinksInInjectedDirs:
                    installOpts.resolveSymlinksInInjectedDirs ?? false,
                  resolutionMode: installOpts.resolutionMode ?? 'highest',
                  dedupePeerDependents:
                    installOpts.dedupePeerDependents ?? false,
                  update: installOpts.update ?? false,
                  bin: path.join(rootDir, 'node_modules', '.bin'),
                  dir: rootDir,
                  hooks,
                  overrides: installOpts.overrides ?? {},
                  tag: installOpts.tag ?? '',
                  unsafePerm: installOpts.unsafePerm ?? false,
                  userAgent: installOpts.userAgent ?? '',
                  include: installOpts.include ?? {
                    optionalDependencies: true,
                    dependencies: true,
                    devDependencies: true,
                  },
                  includeDirect: installOpts.includeDirect ?? {
                    optionalDependencies: false,
                    dependencies: true,
                    devDependencies: false,
                  },
                  ignoreScripts: true,
                  ignorePnpmfile: installOpts.ignorePnpmfile ?? false,
                  ignoredOptionalDependencies:
                    installOpts.ignoredOptionalDependencies ?? [],
                  packageExtensions: installOpts.packageExtensions ?? {},
                  modulesDir:
                    localConfig.modulesDir ?? ('node_modules' as ModulesDir),
                  // pinnedVersion: getPinnedVersion({
                  //   saveExact:
                  //     typeof localConfig.saveExact === 'boolean'
                  //       ? localConfig.saveExact
                  //       : opts.saveExact,
                  //   savePrefix:
                  //     typeof localConfig.savePrefix === 'string'
                  //       ? localConfig.savePrefix
                  //       : opts.savePrefix,
                  // }),
                  rawConfig: {
                    ...installOpts.rawConfig,
                    ...localConfig,
                  },
                  storeController: store.ctrl,
                });

              if (opts.save !== false && typeof newManifest !== 'undefined') {
                await writeProjectManifest(newManifest);
              }

              if (
                opts.strictDepBuilds === true &&
                typeof ignoredBuilds !== 'undefined' &&
                ignoredBuilds.length > 0
              ) {
                throw new IgnoredBuildsError(ignoredBuilds);
              }

              break;
            }

            default: {
              // const action =
              //   ;

              const response = await (currentInput.length === 0
                ? install
                : async (
                    manifest: PackageManifest,
                    opts: Omit<InstallOptions, 'allProjects'> & {
                      bin: string;
                    }
                  ): Promise<{
                    updatedManifest?: ProjectManifest | undefined;
                    ignoredBuilds?: string[] | undefined;
                  }> => {
                    return addDependenciesToPackage(
                      manifest,
                      currentInput,
                      opts
                    );
                  })(
                {
                  ...manifest,
                  completer: '',
                },
                {
                  ...installOpts,
                  ...localConfig,
                  ...getOptionsFromRootManifest(rootDir, manifest),
                  ...opts.allProjectsGraph?.[rootDir]?.package,
                  modulesDir:
                    installOpts.modulesDir ?? ('node_modules' as ModulesDir),
                  lockfileOnly: installOpts.lockfileOnly ?? false,
                  saveWorkspaceProtocol:
                    installOpts.saveWorkspaceProtocol ?? false,
                  lockfileIncludeTarballUrl:
                    installOpts.lockfileIncludeTarballUrl ?? false,
                  force: installOpts.force ?? false,
                  forcePublicHoistPattern:
                    installOpts.forcePublicHoistPattern ?? false,
                  engineStrict: installOpts.engineStrict ?? false,
                  ignorePnpmfile: installOpts.ignorePnpmfile ?? false,
                  unsafePerm: installOpts.unsafePerm ?? false,
                  resolveSymlinksInInjectedDirs:
                    installOpts.resolveSymlinksInInjectedDirs ?? false,
                  dedupePeerDependents:
                    installOpts.dedupePeerDependents ?? false,
                  allowNonAppliedPatches:
                    installOpts.allowNonAppliedPatches ?? false,
                  depth: 0,
                  lockfileDir: opts.lockfileDir,
                  bin: path.join(rootDir, 'node_modules', '.bin'),
                  dir: rootDir,
                  nodeVersion: opts.nodeVersion ?? '',
                  packageExtensions: {},
                  ignoredOptionalDependencies: [],
                  include: installOpts.include ?? {
                    optionalDependencies: true,
                    dependencies: true,
                    devDependencies: true,
                  },
                  includeDirect: installOpts.includeDirect ?? {
                    optionalDependencies: false,
                    dependencies: true,
                    devDependencies: false,
                  },
                  userAgent: opts.userAgent ?? '',
                  tag: installOpts.tag ?? '',
                  resolutionMode: installOpts.resolutionMode ?? 'highest',
                  overrides: installOpts.overrides ?? {},
                  allowedDeprecatedVersions:
                    installOpts.allowedDeprecatedVersions ?? {},
                  hooks,
                  ignoreScripts: true,
                  // pinnedVersion: getPinnedVersion({
                  //   saveExact:
                  //     typeof localConfig.saveExact === 'boolean'
                  //       ? localConfig.saveExact
                  //       : opts.saveExact,
                  //   savePrefix:
                  //     typeof localConfig.savePrefix === 'string'
                  //       ? localConfig.savePrefix
                  //       : opts.savePrefix,
                  // }),
                  rawConfig: {
                    ...installOpts.rawConfig,
                    ...localConfig,
                  },
                  storeController: store.ctrl,
                }
              );

              if (typeof response === 'undefined') {
                return;
              }

              const { updatedManifest: newManifest, ignoredBuilds } = response;

              if (opts.save !== false && typeof newManifest !== 'undefined') {
                await writeProjectManifest(newManifest);
              }

              if (
                opts.strictDepBuilds === true &&
                typeof ignoredBuilds !== 'undefined' &&
                ignoredBuilds.length > 0
              ) {
                throw new IgnoredBuildsError(ignoredBuilds);
              }

              break;
            }
          }

          // const { updatedManifest: newManifest, ignoredBuilds } = await action(
          //   manifest,
          //   {
          //     ...installOpts,
          //     ...localConfig,
          //     ...getOptionsFromRootManifest(rootDir, manifest),
          //     ...opts.allProjectsGraph?.[rootDir]?.package,
          //     bin: path.join(rootDir, 'node_modules', '.bin'),
          //     dir: rootDir,
          //     hooks,
          //     ignoreScripts: true,
          //     pinnedVersion: getPinnedVersion({
          //       saveExact:
          //         typeof localConfig.saveExact === 'boolean'
          //           ? localConfig.saveExact
          //           : opts.saveExact,
          //       savePrefix:
          //         typeof localConfig.savePrefix === 'string'
          //           ? localConfig.savePrefix
          //           : opts.savePrefix,
          //     }),
          //     rawConfig: {
          //       ...installOpts.rawConfig,
          //       ...localConfig,
          //     },
          //     storeController: store.ctrl,
          //   }
          // );

          // if (opts.save !== false) {
          //   await writeProjectManifest(newManifest);
          // }

          // if (
          //   opts.strictDepBuilds === true &&
          //   (ignoredBuilds?.length ?? 0) > 0
          // ) {
          //   throw new IgnoredBuildsError(ignoredBuilds);
          // }

          result[rootDir].status = 'passed';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          logger.info(err);

          if (!opts.bail) {
            result[rootDir] = {
              status: 'failure',
              error: err,
              message: err.message,
              prefix: rootDir,
            };
            return;
          }

          err['prefix'] = rootDir;
          throw err;
        }
      });
    })
  );

  if (
    opts.lockfileOnly !== true &&
    opts.ignoreScripts !== true &&
    ['add', 'install', 'update'].includes(cmdFullName)
  ) {
    await rebuild.handler(
      {
        ...opts,
        pending: opts.pending === true,
        skipIfHasSideEffectsCache: true,
      },
      []
    );
  }

  throwOnFail(result);

  if (
    !Object.values(result).filter(({ status }) => status === 'passed').length &&
    cmdFullName === 'update' &&
    opts.depth === 0
  ) {
    throw new PnpmError(
      'NO_PACKAGE_IN_DEPENDENCIES',
      'None of the specified packages were found in the dependencies of any of the projects.'
    );
  }

  return true;
}

function calculateRepositoryRoot(
  workspaceDir: string,
  projectDirs: string[]
): string {
  // assume repo root is workspace dir
  let relativeRepoRoot = '.';
  for (const rootDir of projectDirs) {
    const relativePartRegExp = new RegExp(`^(\\.\\.\\${path.sep})+`);
    const relativePartMatch = relativePartRegExp.exec(
      path.relative(workspaceDir, rootDir)
    );
    if (relativePartMatch != null) {
      const relativePart = relativePartMatch[0];
      if (relativePart.length > relativeRepoRoot.length) {
        relativeRepoRoot = relativePart;
      }
    }
  }
  return path.resolve(workspaceDir, relativeRepoRoot);
}

export function matchDependencies(
  match: (input: string) => string | null,
  manifest: ProjectManifest,
  include: IncludedDependencies
): string[] {
  const deps = Object.keys(filterDependenciesByType(manifest, include));
  const matchedDeps = [];
  for (const dep of deps) {
    const spec = match(dep);
    if (spec === null) continue;
    matchedDeps.push(spec ? `${dep}@${spec}` : dep);
  }
  return matchedDeps;
}

export type UpdateDepsMatcher = (input: string) => string | null;

export function createMatcher(params: string[]): UpdateDepsMatcher {
  const patterns: string[] = [];

  const specs: string[] = [];

  for (const param of params) {
    const { pattern, versionSpec } = parseUpdateParam(param);

    patterns.push(pattern);

    specs.push(versionSpec ?? '');
  }

  const matcher = createMatcherWithIndex(patterns);

  return (depName: string): string | null => {
    const index = matcher(depName);

    if (index === -1) {
      return null;
    }

    return specs[index] ?? null;
  };
}

export function parseUpdateParam(param: string): {
  pattern: string;
  versionSpec: string | undefined;
} {
  const atIndex = param.indexOf('@', param[0] === '!' ? 2 : 1);

  if (atIndex === -1) {
    return {
      pattern: param,
      versionSpec: undefined,
    };
  }

  return {
    pattern: param.slice(0, atIndex),
    versionSpec: param.slice(atIndex + 1),
  };
}

export function makeIgnorePatterns(ignoredDependencies: string[]): string[] {
  return ignoredDependencies.map((depName) => `!${depName}`);
}

function getAllProjects(
  manifestsByPath: ManifestsByPath,
  allProjectsGraph: ProjectsGraph,
  sort?: boolean | undefined
): (ProjectOptions & HookOptions & { binsDir: string })[] {
  const chunks: ProjectRootDir[][] =
    sort === true
      ? sortPackages(allProjectsGraph)
      : [Object.keys(allProjectsGraph).sort() as ProjectRootDir[]];

  return chunks.flatMap(
    (
      prefixes: ProjectRootDir[],
      buildIndex: number
    ): (ProjectOptions & HookOptions & { binsDir: string })[] => {
      return prefixes
        .map(
          (
            rootDir:
              | ProjectRootDir
              | ProjectRootDirRealPath
              | GlobalPkgDir
              | WorkspaceDir
              | LockFileDir
          ):
            | (ProjectOptions & HookOptions & { binsDir: string })
            | undefined => {
            const pkg = allProjectsGraph[rootDir]?.package;

            if (typeof pkg === 'undefined') {
              return;
            }

            const { rootDirRealPath, modulesDir } = pkg;

            const manifest = manifestsByPath[rootDir]?.manifest;

            if (
              typeof manifest === 'undefined' ||
              typeof modulesDir === 'undefined'
            ) {
              return;
            }

            return {
              // TODO: fix id
              id: '' as ProjectId,
              // TODO: fix binsDir
              binsDir: '',
              buildIndex,
              manifest,
              rootDir,
              rootDirRealPath,
              modulesDir,
            };
          }
        )
        .filter(Boolean);
    }
  );
}

type ManifestsByPath = {
  [dir: string]: Omit<Project, 'rootDir' | 'rootDirRealPath'>;
};

function getManifestsByPath(
  projects: Project[]
): Record<
  | ProjectRootDir
  | ProjectRootDirRealPath
  | GlobalPkgDir
  | WorkspaceDir
  | LockFileDir,
  Omit<Project, 'rootDir' | 'rootDirRealPath'>
> {
  const manifestsByPath: Record<
    string,
    Omit<Project, 'rootDir' | 'rootDirRealPath'>
  > = {};
  for (const { rootDir, manifest, writeProjectManifest } of projects) {
    manifestsByPath[rootDir] = { manifest, writeProjectManifest };
  }
  return manifestsByPath;
}

function getImporters(
  opts: Pick<RecursiveOptions, 'selectedProjectsGraph' | 'ignoredPackages'>
): Array<{
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir;
  rootDirRealPath?: ProjectRootDirRealPath | undefined;
}> {
  let rootDirs: ProjectRootDir[] = Object.keys(
    opts.selectedProjectsGraph
  ) as ProjectRootDir[];

  if (opts.ignoredPackages != null) {
    rootDirs = rootDirs.filter(
      (
        rootDir:
          | ProjectRootDir
          | ProjectRootDirRealPath
          | GlobalPkgDir
          | WorkspaceDir
      ): boolean => {
        return opts.ignoredPackages?.has(rootDir) !== true;
      }
    );
  }

  return rootDirs.map(
    (
      rootDir:
        | ProjectRootDir
        | ProjectRootDirRealPath
        | GlobalPkgDir
        | WorkspaceDir
    ): {
      rootDir:
        | ProjectRootDir
        | ProjectRootDirRealPath
        | GlobalPkgDir
        | WorkspaceDir;
      rootDirRealPath: ProjectRootDirRealPath | undefined;
    } => {
      return {
        rootDir,
        rootDirRealPath:
          opts.selectedProjectsGraph[rootDir]?.package.rootDirRealPath,
      };
    }
  );
}
