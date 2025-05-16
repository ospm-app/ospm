import path from 'node:path';
import {
  buildModules,
  type DepsStateCache,
  linkBinsOfDependencies,
} from '../../build-modules/index.ts';
import { createAllowBuildFunction } from '@pnpm/builder.policy';
import { parseCatalogProtocol } from '../../catalogs.protocol-parser/index.ts';
import type { Catalogs } from '../../catalogs.types/index.ts';
import {
  LAYOUT_VERSION,
  LOCKFILE_VERSION,
  LOCKFILE_MAJOR_VERSION,
  WANTED_LOCKFILE,
} from '../../constants/index.ts';
import { stageLogger, summaryLogger } from '../../core-loggers/index.ts';
import { hashObjectNullableWithPrefix } from '../../crypto.object-hasher/index.ts';
import {
  calcPatchHashes,
  createOverridesMapFromParsed,
  getOutdatedLockfileSetting,
} from '../../lockfile.settings-checker/index.ts';
import { OspmError } from '../../error/index.ts';
import {
  getContext,
  type HookOptions,
  type OspmContext,
  type ProjectOptions,
} from '../../get-context/index.ts';
import {
  headlessInstall,
  type InstallationResultStats,
} from '../../headless/index.ts';
import {
  makeNodeRequireOption,
  runLifecycleHook,
  runLifecycleHooksConcurrently,
  type RunLifecycleHooksConcurrentlyOptions,
} from '../../lifecycle/index.ts';
import { linkBins, linkBinsOfPackages } from '../../link-bins/index.ts';
import {
  writeCurrentLockfile,
  writeLockfiles,
  writeWantedLockfile,
  cleanGitBranchLockfiles,
} from '../../lockfile.fs/index.ts';
import { writePnpFile } from '../../lockfile-to-pnp/index.ts';
import { extendProjectsWithTargetDirs } from '../../lockfile.utils/index.ts';
import {
  allProjectsAreUpToDate,
  satisfiesPackageManifest,
} from '../../lockfile.verification/index.ts';
import { getPreferredVersionsFromLockfileAndManifests } from '../../lockfile.preferred-versions/index.ts';
import { logger, globalInfo, streamParser } from '../../logger/index.ts';
import {
  getAllDependenciesFromManifest,
  getAllUniqueSpecs,
} from '../../manifest-utils/index.ts';
import { writeModulesManifest } from '../../modules-yaml/index.ts';
import { safeReadProjectManifestOnly } from '../../read-project-manifest/index.ts';
import {
  getWantedDependencies,
  type DependenciesGraph,
  type DependenciesGraphNode,
  type PinnedVersion,
  resolveDependencies,
  type UpdateMatchingFunction,
  type WantedDependency,
  type LinkedDependency,
  type ResolvedPackage,
} from '../../resolve-dependencies/index.ts';
import type {
  PreferredVersions,
  Resolution,
} from '../../resolver-base/index.ts';
import type {
  DepPath,
  DependenciesField,
  PeerDependencyIssues,
  ProjectId,
  ProjectManifest,
  ReadPackageHook,
  ProjectRootDir,
  ProjectRootDirRealPath,
  DependenciesMeta,
  GlobalPkgDir,
  ModulesDir,
  WorkspaceDir,
  LockFileDir,
} from '../../types/index.ts';
import isSubdir from 'is-subdir';
import pLimit from 'p-limit';
import mapValues from 'ramda/src/map';
import clone from 'ramda/src/clone';
import isEmpty from 'ramda/src/isEmpty';
import pipeWith from 'ramda/src/pipeWith';
import props from 'ramda/src/props';
import { parseWantedDependencies } from '../parseWantedDependencies.ts';
import { removeDeps } from '../uninstall/removeDeps.ts';
import {
  extendOptions,
  type InstallOptions,
  type ProcessedInstallOptions as StrictInstallOptions,
} from './extendInstallOptions.ts';
import { linkPackages } from './link.ts';
import { reportPeerDependencyIssues } from './reportPeerDependencyIssues.ts';
import { validateModules } from './validateModules.ts';
import { isCI } from 'ci-info';
import type { BundledManifest } from '../../store-controller-types/index.ts';
import type { GenericDependenciesGraphNodeWithResolvedChildren } from '../../resolve-dependencies/resolvePeers.ts';
import type {
  ProjectSnapshot,
  LockfileObject,
  ResolvedDependencies,
  CatalogSnapshots,
} from '../../lockfile.types/index.ts';
import type {
  PatchFile,
  PatchGroupRecord,
} from '../../patching.types/index.ts';
import { groupPatchedDependencies } from 'src/packages/patching.config/groupPatchedDependencies.ts';

class LockfileConfigMismatchError extends OspmError {
  constructor(outdatedLockfileSettingName: string) {
    super(
      'LOCKFILE_CONFIG_MISMATCH',
      `Cannot proceed with the frozen installation. The current "${outdatedLockfileSettingName}" configuration doesn't match the value found in the lockfile`,
      {
        hint: 'Update your lockfile using "ospm install --no-frozen-lockfile"',
      }
    );
  }
}

const BROKEN_LOCKFILE_INTEGRITY_ERRORS = new Set([
  'ERR_OSPM_UNEXPECTED_PKG_CONTENT_IN_STORE',
  'ERR_OSPM_TARBALL_INTEGRITY',
]);

const DEV_PREINSTALL = 'ospm:devPreinstall';

// type InstallMutationOptions = {
//   update?: boolean | undefined;
//   updateToLatest?: boolean | undefined;
//   updateMatching?: UpdateMatchingFunction | undefined;
//   updatePackageManifest?: boolean | undefined;
// };

// type InstallDepsMutation = {
//   mutation: 'install';
//   pruneDirectDependencies?: boolean | undefined;
//   update?: boolean | undefined;
//   updateToLatest?: boolean | undefined;
//   updateMatching?: UpdateMatchingFunction | undefined;
//   updatePackageManifest?: boolean | undefined;
// };

// type InstallSomeDepsMutation = {
//   allowNew?: boolean | undefined;
//   dependencySelectors: string[];
//   mutation: 'installSome';
//   peer?: boolean | undefined;
//   pruneDirectDependencies?: boolean | undefined;
//   pinnedVersion?: PinnedVersion | undefined;
//   targetDependenciesField?: DependenciesField | undefined;
//   update?: boolean | undefined;
//   updateToLatest?: boolean | undefined;
//   updateMatching?: UpdateMatchingFunction | undefined;
//   updatePackageManifest?: boolean | undefined;
// };

// type UninstallSomeDepsMutation = {
//   mutation: 'uninstallSome';
//   dependencyNames: string[];
//   targetDependenciesField?: DependenciesField | undefined;
// };

// type DependenciesMutation =
//   | InstallDepsMutation
//   | InstallSomeDepsMutation
//   | UninstallSomeDepsMutation;

type Opts = Omit<InstallOptions, 'allProjects'> & {
  preferredVersions?: PreferredVersions | undefined;
  pruneDirectDependencies?: boolean | undefined;
  binsDir: string;
  update?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;
};

export async function install(
  manifest: ProjectManifest,
  opts: Opts
): Promise<{
  updatedManifest?: ProjectManifest | undefined;
  ignoredBuilds: string[] | undefined;
}> {
  const rootDir = (opts.dir ?? process.cwd()) as ProjectRootDir;

  const modulesDir = opts.modulesDir ?? ('node_modules' as ModulesDir);

  const mutatedProjectInstall: MutatedProjectInstall = {
    mutation: 'install',
    pruneDirectDependencies: opts.pruneDirectDependencies,
    rootDir,
    update: opts.update,
    updateMatching: opts.updateMatching,
    updateToLatest: opts.updateToLatest,
    updatePackageManifest: opts.updatePackageManifest,
  };

  const { updatedProjects: projects, ignoredBuilds } = await mutateModules(
    [mutatedProjectInstall],
    {
      ...opts,
      bin: '',
      update: opts.update ?? false,
      allProjects: [
        {
          // TODO: fix id
          id: '' as ProjectId,
          // TODO: fix binsDir
          binsDir: '',
          // TODO: fix rootDirRealPath
          rootDirRealPath: '' as ProjectRootDirRealPath,
          buildIndex: 0,
          manifest,
          rootDir,
          modulesDir,
        },
      ],
    }
  );

  return { updatedManifest: projects[0]?.manifest, ignoredBuilds };
}

type ProjectToBeInstalled = {
  id: string;
  buildIndex: number;
  manifest?: ProjectManifest | undefined;
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

export type MutatedProjectInstall = {
  mutation: 'install';
  pruneDirectDependencies?: boolean | undefined;
  update?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

export type MutatedProjectInstallSome = {
  allowNew?: boolean | undefined;
  dependencySelectors: string[];
  mutation: 'installSome';
  peer?: boolean | undefined;
  pruneDirectDependencies?: boolean | undefined;
  pinnedVersion?: PinnedVersion | undefined;
  targetDependenciesField?: DependenciesField | undefined;
  update?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

export type MutatedProjectUninstallSome = {
  mutation: 'uninstallSome';
  dependencyNames: string[];
  targetDependenciesField?: DependenciesField | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

export type MutatedProject =
  | MutatedProjectInstall
  | MutatedProjectInstallSome
  | MutatedProjectUninstallSome;

export type MutateModulesOptions = InstallOptions & {
  bin: string;
  update: boolean;
  preferredVersions?: PreferredVersions | undefined;
  hooks?:
    | {
        readPackage?: ReadPackageHook[] | ReadPackageHook | undefined;
      }
    | InstallOptions['hooks']
    | undefined;
};

export async function mutateModulesInSingleProject(
  project: MutatedProject & {
    binsDir: string;
    manifest: ProjectManifest;
    modulesDir?: ModulesDir | undefined;
  },
  maybeOpts: Omit<MutateModulesOptions, 'allProjects'> & {
    update?: boolean | undefined;
    updateToLatest?: boolean | undefined;
    updateMatching?: UpdateMatchingFunction | undefined;
    updatePackageManifest?: boolean | undefined;
  }
): Promise<{
  ignoredBuilds?: string[] | undefined;
  updatedProject?: UpdatedProject | undefined;
}> {
  const mutatedProject: {
    allowNew?: boolean | undefined;
    dependencySelectors: string[];
    mutation: 'installSome';
    peer?: boolean | undefined;
    pruneDirectDependencies?: boolean | undefined;
    pinnedVersion?: PinnedVersion | undefined;
    targetDependenciesField?: DependenciesField | undefined;
    update?: boolean | undefined;
    updateToLatest?: boolean | undefined;
    updateMatching?: UpdateMatchingFunction | undefined;
    updatePackageManifest?: boolean | undefined;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  } = {
    ...project,
    mutation: project.mutation as 'installSome',
    update: maybeOpts.update,
    dependencySelectors: [],
    updateToLatest: maybeOpts.updateToLatest,
    updateMatching: maybeOpts.updateMatching,
    updatePackageManifest: maybeOpts.updatePackageManifest,
  };

  const projectOptions: ProjectOptions & HookOptions & { binsDir: string } = {
    ...project,
    // TODO: fix id
    id: '' as ProjectId,
    // TODO: fix binsDir
    binsDir: '',
    // TODO: fix rootDirRealPath
    rootDirRealPath: '' as ProjectRootDirRealPath,
    buildIndex: 0,
    modulesDir: project.modulesDir ?? ('node_modules' as ModulesDir),
  };

  const result = await mutateModules([mutatedProject], {
    ...maybeOpts,
    allProjects: [projectOptions],
  });

  return {
    updatedProject: result.updatedProjects[0],
    ignoredBuilds: result.ignoredBuilds,
  };
}

export type MutateModulesResult = {
  updatedProjects: UpdatedProject[];
  stats: InstallationResultStats;
  depsRequiringBuild?: DepPath[] | undefined;
  ignoredBuilds?: string[] | undefined;
};

type InnerInstallResult = {
  readonly updatedProjects: UpdatedProject[];
  readonly stats?: InstallationResultStats | undefined;
  readonly depsRequiringBuild?: DepPath[] | undefined;
  readonly ignoredBuilds: string[] | undefined;
};

const installInContext: InstallFunction = async (
  projects: Array<
    ImporterToUpdate<{
      isNew?: boolean | undefined;
      updateSpec?: boolean | undefined;
      preserveNonSemverVersionSpec?: boolean | undefined;
    }>
  >,
  ctx: OspmContext,
  opts: Omit<StrictInstallOptions, 'patchedDependencies'> & {
    patchedDependencies?: PatchGroupRecord | undefined;
    makePartialCurrentLockfile: boolean;
    needsFullResolution: boolean;
    neverBuiltDependencies?: string[] | undefined;
    onlyBuiltDependencies?: string[] | undefined;
    overrides?: Record<string, string> | undefined;
    updateLockfileMinorVersion: boolean;
    preferredVersions?: PreferredVersions | undefined;
    pruneVirtualStore: boolean;
    scriptsOpts: RunLifecycleHooksConcurrentlyOptions;
    currentLockfileIsUpToDate: boolean;
    hoistWorkspacePackages?: boolean | undefined;
  }
) => {
  try {
    const isPathInsideWorkspace = isSubdir.bind(null, opts.lockfileDir);

    if (opts.frozenLockfile !== true && opts.useLockfile) {
      const allProjectsLocatedInsideWorkspace = Object.values(
        ctx.projects
      ).filter(
        (
          project: ProjectOptions &
            HookOptions & {
              binsDir: string;
            }
        ): boolean => {
          return isPathInsideWorkspace(
            project.rootDirRealPath || project.rootDir
          );
        }
      );

      if (allProjectsLocatedInsideWorkspace.length > projects.length) {
        const newProjects = [...projects];

        const getWantedDepsOpts = {
          autoInstallPeers: opts.autoInstallPeers,
          includeDirect: opts.includeDirect,
          updateWorkspaceDependencies: false,
          nodeExecPath: opts.nodeExecPath,
          injectWorkspacePackages: opts.injectWorkspacePackages,
        };

        const _isWantedDepPrefSame = isWantedDepPrefSame.bind(
          null,
          ctx.wantedLockfile.catalogs,
          opts.catalogs
        );

        for (const project of allProjectsLocatedInsideWorkspace) {
          if (
            typeof project.manifest !== 'undefined' &&
            !newProjects.some(
              ({
                rootDir,
              }: ImporterToUpdate<{
                isNew?: boolean | undefined;
                updateSpec?: boolean | undefined;
                preserveNonSemverVersionSpec?: boolean | undefined;
              }>): boolean => {
                return rootDir === project.rootDir;
              }
            )
          ) {
            // This code block mirrors the installCase() function in
            // mutateModules(). Consider a refactor that combines this logic to
            // deduplicate code.
            const wantedDependencies = getWantedDependencies(
              project.manifest,
              getWantedDepsOpts
            ).map(
              (
                wantedDependency: WantedDependency
              ): WantedDependency & {
                preserveNonSemverVersionSpec: boolean;
              } => {
                return {
                  ...wantedDependency,
                  updateSpec: true,
                  preserveNonSemverVersionSpec: true,
                };
              }
            );

            const importers = ctx.wantedLockfile.importers;

            if (typeof importers !== 'undefined') {
              const importer = importers[project.id];

              if (typeof importer !== 'undefined') {
                forgetResolutionsOfPrevWantedDeps(
                  importer,
                  wantedDependencies,
                  _isWantedDepPrefSame
                );
              }
            }

            newProjects.push({
              mutation: 'install',
              ...project,
              wantedDependencies,
              pruneDirectDependencies: false,
              updatePackageManifest: false,
              update: false,
            });
          }
        }

        const result = await installInContext(newProjects, ctx, {
          ...opts,
          lockfileOnly: true,
        });

        const mo = {
          ...ctx,
          ...opts,
          currentEngine: {
            nodeVersion: opts.nodeVersion,
            ospmVersion:
              opts.packageManager.name === 'ospm'
                ? opts.packageManager.version
                : '',
          },
          currentHoistedLocations: ctx.modulesFile?.hoistedLocations,
          selectedProjectDirs: projects.map(
            (
              project: ImporterToUpdate<{
                isNew?: boolean | undefined;
                updateSpec?: boolean | undefined;
                preserveNonSemverVersionSpec?: boolean | undefined;
              }>
            ):
              | ProjectRootDir
              | ProjectRootDirRealPath
              | GlobalPkgDir
              | WorkspaceDir
              | LockFileDir => {
              return project.rootDir;
            }
          ),
          allProjects: ctx.projects,
          prunedAt: ctx.modulesFile?.prunedAt,
          wantedLockfile: result.newLockfile,
          useLockfile:
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            opts.useLockfile === true && ctx.wantedLockfileIsModified,
          hoistWorkspacePackages: opts.hoistWorkspacePackages,
        };

        const { stats, ignoredBuilds } = await headlessInstall(mo);

        return {
          ...result,
          stats,
          ignoredBuilds,
        };
      }
    }
    if (opts.nodeLinker === 'hoisted' && !opts.lockfileOnly) {
      const result = await _installInContext(projects, ctx, {
        ...opts,
        lockfileOnly: true,
      });

      const { stats, ignoredBuilds } = await headlessInstall({
        ...ctx,
        ...opts,
        currentEngine: {
          nodeVersion: opts.nodeVersion,
          ospmVersion:
            opts.packageManager.name === 'ospm'
              ? opts.packageManager.version
              : '',
        },
        currentHoistedLocations: ctx.modulesFile?.hoistedLocations,
        selectedProjectDirs: projects.map(
          (
            project: ImporterToUpdate<{
              isNew?: boolean | undefined;
              updateSpec?: boolean | undefined;
              preserveNonSemverVersionSpec?: boolean | undefined;
            }>
          ):
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | WorkspaceDir
            | LockFileDir => {
            return project.rootDir;
          }
        ),
        allProjects: ctx.projects,
        prunedAt: ctx.modulesFile?.prunedAt,
        wantedLockfile: result.newLockfile,
        useLockfile: opts.useLockfile && ctx.wantedLockfileIsModified,
        hoistWorkspacePackages: opts.hoistWorkspacePackages,
      });

      return {
        ...result,
        stats,
        ignoredBuilds,
      };
    }

    if (opts.lockfileOnly && ctx.existsCurrentLockfile) {
      logger.warn({
        message:
          '`node_modules` is present. Lockfile only installation will make it out-of-date',
        prefix: ctx.lockfileDir ?? '',
      });
    }

    return await _installInContext(projects, ctx, opts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      !BROKEN_LOCKFILE_INTEGRITY_ERRORS.has(error.code) ||
      (!ctx.existsNonEmptyWantedLockfile && !ctx.existsCurrentLockfile)
    ) {
      throw error;
    }

    opts.needsFullResolution = true;

    // Ideally, we would not update but currently there is no other way to redownload the integrity of the package
    for (const project of projects) {
      if ('update' in project) {
        project.update = true; // InstallMutationOptions
      }
    }

    logger.warn({
      error,
      message: error.message,
      prefix: ctx.lockfileDir ?? '',
    });

    logger.error(
      new OspmError(
        error.code,
        'The lockfile is broken! A full installation will be performed in an attempt to fix it.'
      )
    );

    return _installInContext(projects, ctx, opts);
  } finally {
    await opts.storeController.close();
  }
};

export async function mutateModules(
  projects: MutatedProject[],
  maybeOpts: MutateModulesOptions
): Promise<MutateModulesResult> {
  const reporter = maybeOpts.reporter;

  if (typeof reporter !== 'undefined' && typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const opts = extendOptions(maybeOpts);

  if (!opts.include.dependencies && opts.include.optionalDependencies) {
    throw new OspmError(
      'OPTIONAL_DEPS_REQUIRE_PROD_DEPS',
      'Optional dependencies cannot be installed without production dependencies'
    );
  }

  const installsOnly = allMutationsAreInstalls(projects);

  if (!installsOnly) {
    opts.strictPeerDependencies = false;
  }

  const rootProjectManifest =
    opts.allProjects.find(({ rootDir }: ProjectOptions): boolean => {
      return rootDir === opts.lockfileDir;
    })?.manifest ??
    // When running install/update on a subset of projects, the root project might not be included,
    // so reading its manifest explicitly here.
    (await safeReadProjectManifestOnly(opts.lockfileDir));

  let ctx = await getContext(opts);

  if (opts.lockfileOnly !== true && ctx.modulesFile !== null) {
    const { purged } = await validateModules(
      ctx.modulesFile,
      Object.values(ctx.projects),
      {
        forceNewModules: installsOnly,
        include: opts.include,
        lockfileDir: opts.lockfileDir,
        modulesDir: opts.modulesDir,
        registries: opts.registries,
        storeDir: opts.storeDir,
        virtualStoreDir: ctx.virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
        confirmModulesPurge: opts.confirmModulesPurge && !isCI,

        forceHoistPattern: opts.forceHoistPattern,
        hoistPattern: opts.hoistPattern,
        currentHoistPattern: ctx.currentHoistPattern,

        forcePublicHoistPattern: opts.forcePublicHoistPattern,
        publicHoistPattern: opts.publicHoistPattern,
        currentPublicHoistPattern: ctx.currentPublicHoistPattern,
        global: opts.global,
      }
    );

    if (purged) {
      ctx = await getContext(opts);
    }
  }

  if (opts.hooks.preResolution) {
    await opts.hooks.preResolution({
      currentLockfile: ctx.currentLockfile,
      wantedLockfile: ctx.wantedLockfile,
      existsCurrentLockfile: ctx.existsCurrentLockfile,
      existsNonEmptyWantedLockfile: ctx.existsNonEmptyWantedLockfile,
      lockfileDir: ctx.lockfileDir,
      storeDir: ctx.storeDir,
      registries: ctx.registries,
    });
  }

  const pruneVirtualStore =
    typeof ctx.modulesFile?.prunedAt === 'string' && opts.modulesCacheMaxAge > 0
      ? cacheExpired(ctx.modulesFile.prunedAt, opts.modulesCacheMaxAge)
      : true;

  if (maybeOpts.ignorePackageManifest !== true) {
    for (const { manifest, rootDir } of Object.values(ctx.projects)) {
      if (typeof manifest === 'undefined') {
        throw new Error(`No package.json found in "${rootDir}"`);
      }
    }
  }

  const result = await _install();

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  if (global['verifiedFileIntegrity'] > 1000) {
    globalInfo(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      `The integrity of ${global['verifiedFileIntegrity']} files was checked. This might have caused installation to take longer.`
    );
  }

  if (reporter != null && typeof reporter === 'function') {
    streamParser.removeListener('data', reporter);
  }

  if (opts.mergeGitBranchLockfiles && typeof ctx.lockfileDir === 'string') {
    await cleanGitBranchLockfiles(ctx.lockfileDir);
  }

  return {
    updatedProjects: result.updatedProjects,
    stats: result.stats ?? { added: 0, removed: 0, linkedToRoot: 0 },
    depsRequiringBuild: result.depsRequiringBuild,
    ignoredBuilds: result.ignoredBuilds,
  };

  async function _install(): Promise<InnerInstallResult> {
    const scriptsOpts: RunLifecycleHooksConcurrentlyOptions = {
      extraBinPaths: opts.extraBinPaths,
      extraNodePaths: ctx.extraNodePaths,
      extraEnv: opts.extraEnv,
      preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
      rawConfig: opts.rawConfig,
      resolveSymlinksInInjectedDirs: opts.resolveSymlinksInInjectedDirs,
      scriptsPrependNodePath: opts.scriptsPrependNodePath,
      scriptShell: opts.scriptShell,
      shellEmulator: opts.shellEmulator,
      stdio: opts.ownLifecycleHooksStdio,
      storeController: opts.storeController,
      unsafePerm: opts.unsafePerm || false,
      prepareExecutionEnv: opts.prepareExecutionEnv,
    };

    if (
      !opts.ignoreScripts &&
      !opts.ignorePackageManifest &&
      typeof rootProjectManifest?.scripts?.[DEV_PREINSTALL] !== 'undefined'
    ) {
      await runLifecycleHook(DEV_PREINSTALL, rootProjectManifest, {
        ...scriptsOpts,
        depPath: opts.lockfileDir,
        pkgRoot: opts.lockfileDir,
        rootModulesDir: ctx.rootModulesDir,
      });
    }

    const packageExtensionsChecksum = hashObjectNullableWithPrefix(
      opts.packageExtensions
    );

    const ospmfileChecksum = await opts.hooks.calculateOspmfileChecksum?.();

    const patchedDependencies = opts.ignorePackageManifest
      ? ctx.wantedLockfile.patchedDependencies
      : opts.patchedDependencies
        ? await calcPatchHashes(opts.patchedDependencies, opts.lockfileDir)
        : {};

    const patchedDependenciesWithResolvedPath =
      typeof patchedDependencies === 'undefined'
        ? undefined
        : mapValues.default(
            (
              patchFile: PatchFile
            ): {
              hash: string;
              path: string;
            } => {
              return {
                hash: patchFile.hash,
                path: path.join(opts.lockfileDir, patchFile.path),
              };
            },
            patchedDependencies
          );

    const patchGroups =
      patchedDependenciesWithResolvedPath &&
      groupPatchedDependencies(patchedDependenciesWithResolvedPath);

    const frozenLockfile =
      opts.frozenLockfile ||
      (opts.frozenLockfileIfExists && ctx.existsNonEmptyWantedLockfile);

    let outdatedLockfileSettings = false;

    const overridesMap = createOverridesMapFromParsed(opts.parsedOverrides);

    if (opts.ignorePackageManifest !== true) {
      const outdatedLockfileSettingName = getOutdatedLockfileSetting(
        ctx.wantedLockfile,
        {
          autoInstallPeers: opts.autoInstallPeers,
          injectWorkspacePackages: opts.injectWorkspacePackages,
          excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
          peersSuffixMaxLength: opts.peersSuffixMaxLength,
          overrides: overridesMap,
          ignoredOptionalDependencies: opts.ignoredOptionalDependencies.sort(),
          packageExtensionsChecksum,
          patchedDependencies,
          ospmfileChecksum,
        }
      );

      outdatedLockfileSettings = outdatedLockfileSettingName !== null;

      if (frozenLockfile && outdatedLockfileSettingName !== null) {
        throw new LockfileConfigMismatchError(outdatedLockfileSettingName);
      }
    }

    const _isWantedDepPrefSame = isWantedDepPrefSame.bind(
      null,
      ctx.wantedLockfile.catalogs,
      opts.catalogs
    );

    const upToDateLockfileMajorVersion = ctx.wantedLockfile.lockfileVersion
      .toString()
      .startsWith(`${LOCKFILE_MAJOR_VERSION}.`);

    let needsFullResolution =
      outdatedLockfileSettings ||
      opts.fixLockfile ||
      !upToDateLockfileMajorVersion ||
      opts.forceFullResolution;

    if (needsFullResolution) {
      ctx.wantedLockfile.settings = {
        autoInstallPeers: opts.autoInstallPeers,
        excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
        peersSuffixMaxLength: opts.peersSuffixMaxLength,
        injectWorkspacePackages: opts.injectWorkspacePackages,
      };

      ctx.wantedLockfile.overrides = overridesMap;

      ctx.wantedLockfile.packageExtensionsChecksum = packageExtensionsChecksum;

      ctx.wantedLockfile.ignoredOptionalDependencies =
        opts.ignoredOptionalDependencies;

      ctx.wantedLockfile.ospmfileChecksum = ospmfileChecksum;

      ctx.wantedLockfile.patchedDependencies = patchedDependencies;
    } else if (!frozenLockfile) {
      ctx.wantedLockfile.settings = {
        autoInstallPeers: opts.autoInstallPeers,
        excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
        peersSuffixMaxLength: opts.peersSuffixMaxLength,
        injectWorkspacePackages: opts.injectWorkspacePackages,
      };
    }

    const frozenInstallResult = await tryFrozenInstall({
      frozenLockfile,
      needsFullResolution,
      patchedDependenciesWithResolvedPath,
      upToDateLockfileMajorVersion,
    });

    if (frozenInstallResult !== null) {
      if ('needsFullResolution' in frozenInstallResult) {
        needsFullResolution = frozenInstallResult.needsFullResolution;
      } else {
        return frozenInstallResult;
      }
    }

    const projectsToInstall: ImporterToUpdate<{
      pruneDirectDependencies?: boolean | undefined;
    }>[] = [];

    let preferredSpecs: Record<string, string> | null = null;

    // TODO: make it concurrent
    for (const project of projects) {
      switch (project.mutation) {
        case 'uninstallSome': {
          const prj = ctx.projects[project.rootDir];

          if (typeof prj === 'undefined') {
            continue;
          }

          const projectOpts = {
            ...project,
            ...prj,
          };

          const p: UninstallSomeImporterToUpdate<{
            pruneDirectDependencies?: boolean | undefined;
          }> = {
            ...projectOpts,
            mutation: 'uninstallSome',
            pruneDirectDependencies: false,
            removePackages: project.dependencyNames,
            updatePackageManifest: true,
            wantedDependencies: [],
            dependencyNames: [],
          };

          projectsToInstall.push(p);

          break;
        }

        case 'install': {
          const prj = ctx.projects[project.rootDir];

          if (typeof prj === 'undefined') {
            continue;
          }

          const projectOpts = {
            ...project,
            ...prj,
          };

          const p: InstallImporterToUpdate<{
            pruneDirectDependencies?: boolean | undefined;
          }> = {
            ...projectOpts,
            mutation: 'install',
            updatePackageManifest:
              project.updatePackageManifest ?? project.update,
            wantedDependencies: [],
            buildIndex: 0,
          };

          await installCase(p);

          break;
        }

        case 'installSome': {
          const prj = ctx.projects[project.rootDir];

          if (typeof prj === 'undefined') {
            continue;
          }

          const projectOpts = {
            ...project,
            ...prj,
          };

          const p: InstallSomeImporterToUpdate<{
            pruneDirectDependencies?: boolean | undefined;
          }> = {
            ...projectOpts,
            updatePackageManifest: projectOpts.updatePackageManifest !== false,
          };

          await installSome(p);

          break;
        }
      }
    }

    async function installCase(project: {
      manifest?: ProjectManifest | undefined;
      id: ProjectId;
      update?: boolean | undefined;
    }): Promise<void> {
      if (typeof project.manifest === 'undefined') {
        return;
      }

      const wantedDependencies = getWantedDependencies(project.manifest, {
        autoInstallPeers: opts.autoInstallPeers,
        includeDirect: opts.includeDirect,
        updateWorkspaceDependencies: project.update,
        nodeExecPath: opts.nodeExecPath,
      }).map(
        (
          wantedDependency: WantedDependency
        ): {
          updateSpec: boolean;
          preserveNonSemverVersionSpec: boolean;
          alias?: string | undefined;
          pref?: string | undefined;
          dev?: boolean | undefined;
          optional?: boolean | undefined;
          raw?: string | undefined;
          injected?: boolean | undefined;
          pinnedVersion?: PinnedVersion | undefined;
          nodeExecPath?: string | undefined;
        } => {
          return {
            ...wantedDependency,
            updateSpec: true,
            preserveNonSemverVersionSpec: true,
          };
        }
      );

      const importer = ctx.wantedLockfile.importers?.[project.id];

      if (typeof importer !== 'undefined') {
        forgetResolutionsOfPrevWantedDeps(
          importer,
          wantedDependencies,
          _isWantedDepPrefSame
        );
      }

      if (
        opts.ignoreScripts &&
        project.manifest.scripts &&
        (typeof project.manifest.scripts.preinstall === 'string' ||
          typeof project.manifest.scripts.install === 'string' ||
          typeof project.manifest.scripts.postinstall === 'string' ||
          typeof project.manifest.scripts.prepare === 'string')
      ) {
        ctx.pendingBuilds.push(project.id);
      }

      const p: InstallImporterToUpdate<{
        pruneDirectDependencies?: boolean | undefined;
      }> = {
        ...project,
        pruneDirectDependencies: false,
        wantedDependencies,
        buildIndex: 0,
        binsDir: '',
        modulesDir: 'node_modules' as ModulesDir,
        rootDir: '' as ProjectRootDir,
        updatePackageManifest: false,
        mutation: 'install',
      };

      projectsToInstall.push(p);
    }

    async function installSome(
      project: InstallSomeImporterToUpdate<{
        pruneDirectDependencies?: boolean | undefined;
      }>
    ): Promise<void> {
      const currentPrefs = opts.ignoreCurrentPrefs
        ? {}
        : getAllDependenciesFromManifest(project.manifest);

      const optionalDependencies = project.targetDependenciesField
        ? {}
        : (project.manifest?.optionalDependencies ?? {});

      const devDependencies = project.targetDependenciesField
        ? {}
        : project.manifest?.devDependencies || {};

      if (preferredSpecs == null) {
        const manifests = [];

        for (const versions of ctx.workspacePackages.values()) {
          for (const { manifest } of versions.values()) {
            manifests.push(manifest);
          }
        }

        preferredSpecs = getAllUniqueSpecs(manifests);
      }

      const wantedDeps = parseWantedDependencies(project.dependencySelectors, {
        allowNew: project.allowNew !== false,
        currentPrefs,
        defaultTag: opts.tag,
        dev: project.targetDependenciesField === 'devDependencies',
        devDependencies,
        optional: project.targetDependenciesField === 'optionalDependencies',
        optionalDependencies,
        updateWorkspaceDependencies: project.update,
        preferredSpecs,
        overrides: opts.overrides,
        defaultCatalog: opts.catalogs.default,
      });

      const p = {
        ...project,
        pruneDirectDependencies: false,
        wantedDependencies: wantedDeps.map(
          (
            wantedDep: WantedDependency
          ): WantedDependency & {
            isNew: boolean;
            updateSpec: boolean;
            nodeExecPath?: string | undefined;
          } => {
            return {
              ...wantedDep,
              isNew: typeof currentPrefs[wantedDep.alias ?? ''] === 'undefined',
              updateSpec: true,
              nodeExecPath: opts.nodeExecPath,
            };
          }
        ),
      };

      projectsToInstall.push(p);
    }

    // Unfortunately, the private lockfile may differ from the public one.
    // A user might run named installations on a project that has a ospm-lock.yaml file before running a noop install
    const makePartialCurrentLockfile =
      !installsOnly &&
      ((ctx.existsNonEmptyWantedLockfile && !ctx.existsCurrentLockfile) ||
        !ctx.currentLockfileIsUpToDate);

    const result = await installInContext(projectsToInstall, ctx, {
      ...opts,
      currentLockfileIsUpToDate:
        !ctx.existsNonEmptyWantedLockfile || ctx.currentLockfileIsUpToDate,
      makePartialCurrentLockfile,
      needsFullResolution,
      pruneVirtualStore,
      scriptsOpts,
      updateLockfileMinorVersion: true,
      patchedDependencies: patchGroups,
    });

    return {
      updatedProjects: result.projects,
      stats: result.stats,
      depsRequiringBuild: result.depsRequiringBuild,
      ignoredBuilds: result.ignoredBuilds,
    };
  }

  /**
   * Attempt to perform a "frozen install".
   *
   * A "frozen install" will be performed if:
   *
   *   1. The --frozen-lockfile flag was explicitly specified or evaluates to
   *      true based on conditions like running on CI.
   *   2. No workspace modifications have been made that would invalidate the
   *      ospm-lock.yaml file. In other words, the ospm-lock.yaml file is
   *      known to be "up-to-date".
   *
   * A frozen install is significantly faster since the ospm-lock.yaml file
   * can treated as immutable, skipping expensive lookups to acquire new
   * dependencies. For this reason, a frozen install should be performed even
   * if --frozen-lockfile wasn't explicitly specified. This allows users to
   * benefit from the increased performance of a frozen install automatically.
   *
   * If a frozen install is not possible, this function will return null.
   * This indicates a standard mutable install needs to be performed.
   *
   * Note this function may update the ospm-lock.yaml file if the lockfile was
   * on a different major version, needs to be merged due to git conflicts,
   * etc. These changes update the format of the ospm-lock.yaml file, but do
   * not change recorded dependency resolutions.
   */
  async function tryFrozenInstall({
    frozenLockfile,
    needsFullResolution,
    patchedDependenciesWithResolvedPath,
    upToDateLockfileMajorVersion,
  }: {
    frozenLockfile: boolean;
    needsFullResolution: boolean;
    patchedDependenciesWithResolvedPath?:
      | Record<
          string,
          {
            hash: string;
            path: string;
          }
        >
      | undefined;
    upToDateLockfileMajorVersion: boolean;
  }): Promise<InnerInstallResult | { needsFullResolution: boolean } | null> {
    const isFrozenInstallPossible =
      // A frozen install is never possible when any of these are true:
      !ctx.lockfileHadConflicts &&
      !opts.fixLockfile &&
      !opts.dedupe &&
      installsOnly &&
      // If the user explicitly requested a frozen lockfile install, attempt
      // to perform one. An error will be thrown if updates are required.
      (frozenLockfile ||
        // Otherwise, check if a frozen-like install is possible for
        // performance. This will be the case if all projects are up-to-date.
        opts.ignorePackageManifest ||
        (!needsFullResolution &&
          opts.preferFrozenLockfile &&
          (!opts.pruneLockfileImporters ||
            Object.keys(ctx.wantedLockfile.importers ?? {}).length ===
              Object.keys(ctx.projects).length) &&
          ctx.existsNonEmptyWantedLockfile &&
          ctx.wantedLockfile.lockfileVersion === LOCKFILE_VERSION &&
          (await allProjectsAreUpToDate(Object.values(ctx.projects), {
            catalogs: opts.catalogs,
            autoInstallPeers: opts.autoInstallPeers,
            excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
            linkWorkspacePackages: opts.linkWorkspacePackagesDepth >= 0,
            wantedLockfile: ctx.wantedLockfile,
            workspacePackages: ctx.workspacePackages,
            lockfileDir: opts.lockfileDir,
          }))));

    const patchGroups =
      patchedDependenciesWithResolvedPath &&
      groupPatchedDependencies(patchedDependenciesWithResolvedPath);

    if (!isFrozenInstallPossible) {
      return null;
    }

    if (needsFullResolution) {
      throw new OspmError(
        'FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE',
        'Cannot perform a frozen installation because the version of the lockfile is incompatible with this version of ospm',
        {
          hint: `Try either:
1. Aligning the version of ospm that generated the lockfile with the version that installs from it, or
2. Migrating the lockfile so that it is compatible with the newer version of ospm, or
3. Using "ospm install --no-frozen-lockfile".
Note that in CI environments, this setting is enabled by default.`,
        }
      );
    }

    if (!opts.ignorePackageManifest) {
      const _satisfiesPackageManifest = satisfiesPackageManifest.bind(null, {
        autoInstallPeers: opts.autoInstallPeers,
        excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
      });

      for (const { id, manifest, rootDir } of Object.values(ctx.projects)) {
        if (typeof manifest === 'undefined') {
          continue;
        }

        const { satisfies, detailedReason } = _satisfiesPackageManifest(
          ctx.wantedLockfile.importers?.[id],
          manifest
        );

        if (!satisfies) {
          if (!ctx.existsWantedLockfile) {
            throw new OspmError(
              'NO_LOCKFILE',
              `Cannot install with "frozen-lockfile" because ${WANTED_LOCKFILE} is absent`,
              {
                hint: 'Note that in CI environments this setting is true by default. If you still need to run install in such cases, use "ospm install --no-frozen-lockfile"',
              }
            );
          }

          throw new OspmError(
            'OUTDATED_LOCKFILE',
            `Cannot install with "frozen-lockfile" because ${WANTED_LOCKFILE} is not up to date with ${path.join(
              '<ROOT>',
              path.relative(
                opts.lockfileDir,
                path.join(rootDir, 'package.json')
              )
            )}`,
            {
              hint: `Note that in CI environments this setting is true by default. If you still need to run install in such cases, use "ospm install --no-frozen-lockfile"

  Failure reason:
  ${detailedReason ?? ''}`,
            }
          );
        }
      }
    }

    if (opts.lockfileOnly) {
      // The lockfile will only be changed if the workspace will have new projects with no dependencies.
      await writeWantedLockfile(ctx.lockfileDir ?? '', ctx.wantedLockfile);

      return {
        updatedProjects: projects
          .map(
            (
              mutatedProject: MutatedProject
            ): (ProjectOptions & HookOptions) | undefined => {
              return ctx.projects[mutatedProject.rootDir];
            }
          )
          .filter(Boolean),
        ignoredBuilds: undefined,
      };
    }

    if (!ctx.existsNonEmptyWantedLockfile) {
      if (
        Object.values(ctx.projects).some(
          (
            project: ProjectOptions &
              HookOptions & {
                binsDir: string;
              }
          ): boolean => {
            return (
              typeof project.manifest !== 'undefined' &&
              pkgHasDependencies(project.manifest)
            );
          }
        )
      ) {
        throw new Error(
          `Headless installation requires a ${WANTED_LOCKFILE} file`
        );
      }

      return null;
    }

    if (maybeOpts.ignorePackageManifest === true) {
      logger.info({
        message: 'Importing packages to virtual store',
        prefix: opts.lockfileDir,
      });
    } else {
      logger.info({
        message: 'Lockfile is up to date, resolution step is skipped',
        prefix: opts.lockfileDir,
      });
    }

    try {
      const { stats, ignoredBuilds } = await headlessInstall({
        ...ctx,
        ...opts,
        currentEngine: {
          nodeVersion: opts.nodeVersion,
          ospmVersion:
            opts.packageManager.name === 'ospm'
              ? opts.packageManager.version
              : '',
        },
        currentHoistedLocations: ctx.modulesFile?.hoistedLocations,
        patchedDependencies: patchGroups,
        selectedProjectDirs: projects.map(
          (
            project: MutatedProject
          ):
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | WorkspaceDir
            | LockFileDir => {
            return project.rootDir;
          }
        ),
        allProjects: ctx.projects,
        prunedAt: ctx.modulesFile?.prunedAt,
        pruneVirtualStore,
        wantedLockfile:
          maybeOpts.ignorePackageManifest === true
            ? undefined
            : ctx.wantedLockfile,
        useLockfile: opts.useLockfile && ctx.wantedLockfileIsModified,
      });

      if (
        (opts.useLockfile &&
          opts.saveLockfile &&
          opts.mergeGitBranchLockfiles) ||
        (!upToDateLockfileMajorVersion && !opts.frozenLockfile)
      ) {
        await writeLockfiles({
          currentLockfile: ctx.currentLockfile,
          currentLockfileDir: ctx.virtualStoreDir,
          wantedLockfile: ctx.wantedLockfile,
          wantedLockfileDir: ctx.lockfileDir ?? '',
          useGitBranchLockfile: opts.useGitBranchLockfile,
          mergeGitBranchLockfiles: opts.mergeGitBranchLockfiles,
        });
      }

      return {
        updatedProjects: projects
          .map(
            (
              mutatedProject: MutatedProject
            ): {
              manifest?: ProjectManifest | undefined;
              modulesDir?: string | undefined;
              id?:
                | (string & {
                    __brand: 'ProjectId';
                  })
                | undefined;
              originalManifest?: ProjectManifest | undefined;
              buildIndex: number;
              binsDir: string;
              rootDir:
                | ProjectRootDir
                | ProjectRootDirRealPath
                | GlobalPkgDir
                | WorkspaceDir
                | LockFileDir;
              rootDirRealPath?: ProjectRootDirRealPath | undefined;
            } | null => {
              const project = ctx.projects[mutatedProject.rootDir];

              if (typeof project === 'undefined') {
                return null;
              }

              return {
                ...project,
                manifest: project.originalManifest ?? project.manifest,
              };
            }
          )
          .filter(Boolean),
        stats,
        ignoredBuilds,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (
        frozenLockfile ||
        (error.code !== 'ERR_OSPM_LOCKFILE_MISSING_DEPENDENCY' &&
          !BROKEN_LOCKFILE_INTEGRITY_ERRORS.has(error.code)) ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (ctx.existsNonEmptyWantedLockfile !== true &&
          !ctx.existsCurrentLockfile)
      ) {
        throw error;
      }

      if (BROKEN_LOCKFILE_INTEGRITY_ERRORS.has(error.code)) {
        needsFullResolution = true;

        // Ideally, we would not update but currently there is no other way to redownload the integrity of the package
        for (const project of projects) {
          if ('update' in project) {
            project.update = true; // InstallMutationOptions
          }
        }
      }

      // A broken lockfile may be caused by a badly resolved Git conflict
      logger.warn({
        error,
        message: error.message,
        prefix: ctx.lockfileDir ?? '',
      });

      logger.error(
        new OspmError(
          error.code,
          'The lockfile is broken! Resolution step will be performed to fix it.'
        )
      );

      return { needsFullResolution };
    }
  }
}

function cacheExpired(prunedAt: string, maxAgeInMinutes: number): boolean {
  return (
    (Date.now() - new Date(prunedAt).valueOf()) / (1000 * 60) > maxAgeInMinutes
  );
}

function pkgHasDependencies(manifest: ProjectManifest): boolean {
  return Boolean(
    Object.keys(manifest.dependencies ?? {}).length > 0 ||
      Object.keys(manifest.devDependencies ?? {}).length ||
      Object.keys(manifest.optionalDependencies ?? {}).length
  );
}

// If the specifier is new, the old resolution probably does not satisfy it anymore.
// By removing these resolutions we ensure that they are resolved again using the new specs.
function forgetResolutionsOfPrevWantedDeps(
  importer: ProjectSnapshot,
  wantedDeps: WantedDependency[],
  isWantedDepPrefSame: (
    alias: string,
    prevPref: string | undefined,
    nextPref: string
  ) => boolean
): void {
  if (typeof importer.specifiers === 'undefined') {
    return;
  }

  importer.dependencies = importer.dependencies ?? {};
  importer.devDependencies = importer.devDependencies ?? {};
  importer.optionalDependencies = importer.optionalDependencies ?? {};

  for (const { alias, pref } of wantedDeps) {
    if (
      typeof alias === 'string' &&
      typeof pref === 'string' &&
      !isWantedDepPrefSame(alias, importer.specifiers[alias], pref)
    ) {
      if (importer.dependencies[alias]?.startsWith('link:') !== true) {
        delete importer.dependencies[alias];
      }

      delete importer.devDependencies[alias];
      delete importer.optionalDependencies[alias];
    }
  }
}

function forgetResolutionsOfAllPrevWantedDeps(
  wantedLockfile?: LockfileObject | undefined
): void {
  // Similar to the forgetResolutionsOfPrevWantedDeps function above, we can
  // delete existing resolutions in importers to make sure they're resolved
  // again.
  if (
    typeof wantedLockfile?.importers !== 'undefined' &&
    !isEmpty.default(wantedLockfile.importers)
  ) {
    wantedLockfile.importers = mapValues.default(
      ({
        dependencies: _,
        devDependencies: __,
        optionalDependencies: ___,
        ...rest
      }): {
        specifiers: ResolvedDependencies;
        dependenciesMeta?: DependenciesMeta | undefined;
        publishDirectory?: string | undefined;
      } => {
        return rest;
      },
      wantedLockfile.importers
    );
  }

  // The resolveDependencies function looks at previous PackageSnapshot
  // dependencies/optionalDependencies blocks and merges them with new resolved
  // deps. Clear the previous PackageSnapshot fields so the newly resolved deps
  // are always used.
  if (
    typeof wantedLockfile?.packages !== 'undefined' &&
    !isEmpty.default(wantedLockfile.packages)
  ) {
    wantedLockfile.packages = mapValues.default(
      ({
        dependencies: _,
        optionalDependencies: __,
        ...rest
      }): {
        id?: string | undefined;
        patched?: boolean | undefined;
        hasBin?: boolean | undefined;
        name?: string | undefined;
        version?: string | undefined;
        resolution?: Resolution | undefined;
        peerDependencies?: Record<string, string> | undefined;
        peerDependenciesMeta?:
          | { [name: string]: { optional: boolean | undefined } }
          | undefined;
        bundledDependencies?: string[] | boolean | undefined;
        engines?:
          | (Record<string, string> & { node?: string | undefined })
          | undefined;
        os?: string[] | undefined;
        cpu?: string[] | undefined;
        libc?: string[] | undefined;
        deprecated?: string | undefined;
        optional?: boolean | undefined;
        transitivePeerDependencies?: string[] | undefined;
      } => {
        return rest;
      },
      wantedLockfile.packages
    );
  }
}

/**
 * Check if a wanted pref is the same.
 *
 * It would be different if the user modified a dependency in package.json or a
 * catalog entry in ospm-workspace.yaml. This is normally a simple check to see
 * if the specifier strings match, but catalogs make this more involved since we
 * also have to check if the catalog config in ospm-workspace.yaml is the same.
 */
function isWantedDepPrefSame(
  prevCatalogs: CatalogSnapshots | undefined,
  catalogsConfig: Catalogs | undefined,
  alias: string,
  prevPref: string | undefined,
  nextPref: string
): boolean {
  if (prevPref !== nextPref) {
    return false;
  }

  // When ospm catalogs are used, the specifiers can be the same (e.g.
  // "catalog:default"), but the wanted versions for the dependency can be
  // different after resolution if the catalog config was just edited.
  const catalogName = parseCatalogProtocol(prevPref);

  // If there's no catalog name, the catalog protocol was not used and we
  // can assume the pref is the same since prevPref and nextPref match.
  if (catalogName === null) {
    return true;
  }

  const prevCatalogEntrySpec = prevCatalogs?.[catalogName]?.[alias]?.specifier;
  const nextCatalogEntrySpec = catalogsConfig?.[catalogName]?.[alias];

  return prevCatalogEntrySpec === nextCatalogEntrySpec;
}

export async function addDependenciesToPackage(
  manifest: ProjectManifest,
  dependencySelectors: string[],
  opts: Omit<InstallOptions, 'allProjects'> & {
    bin: string;
    allowNew?: boolean | undefined;
    peer?: boolean | undefined;
    pinnedVersion?: 'major' | 'minor' | 'patch' | undefined;
    targetDependenciesField?: DependenciesField | undefined;
    update?: boolean | undefined;
    updateToLatest?: boolean | undefined;
    updateMatching?: UpdateMatchingFunction | undefined;
    updatePackageManifest?: boolean | undefined;
  }
): Promise<{
  updatedManifest?: ProjectManifest | undefined;
  ignoredBuilds?: string[] | undefined;
}> {
  const rootDir = (opts.dir ?? process.cwd()) as ProjectRootDir;

  const { updatedProjects: projects, ignoredBuilds } = await mutateModules(
    [
      {
        allowNew: opts.allowNew,
        dependencySelectors,
        mutation: 'installSome',
        peer: opts.peer,
        pinnedVersion: opts.pinnedVersion,
        rootDir,
        targetDependenciesField: opts.targetDependenciesField,
        update: opts.update,
        updateMatching: opts.updateMatching,
        updatePackageManifest: opts.updatePackageManifest,
        updateToLatest: opts.updateToLatest,
      },
    ],
    {
      ...opts,
      update: opts.update ?? false,
      lockfileDir: opts.lockfileDir,
      allProjects: [
        {
          // TODO: fix id
          id: '' as ProjectId,
          // TODO: fix rootDirRealPath
          rootDirRealPath: '' as ProjectRootDirRealPath,
          modulesDir: opts.modulesDir ?? ('node_modules' as ModulesDir),
          buildIndex: 0,
          binsDir: opts.bin,
          manifest,
          rootDir,
        },
      ],
    }
  );

  return { updatedManifest: projects[0]?.manifest, ignoredBuilds };
}

export type InstallImporterToUpdate<WantedExtraProps> = {
  mutation: 'install';
  pruneDirectDependencies?: boolean | undefined;
  update?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;

  buildIndex: number;
  binsDir: string;
  id: ProjectId;
  manifest?: ProjectManifest | undefined;
  originalManifest?: ProjectManifest | undefined;
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  removePackages?: string[] | undefined;
  wantedDependencies?: Array<WantedDependency & WantedExtraProps> | undefined;
};

export type InstallSomeImporterToUpdate<WantedExtraProps> = {
  allowNew?: boolean | undefined;
  dependencySelectors: string[];
  mutation: 'installSome';
  peer?: boolean | undefined;
  pruneDirectDependencies?: boolean | undefined;
  pinnedVersion?: PinnedVersion | undefined;
  targetDependenciesField?: DependenciesField | undefined;
  update?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updatePackageManifest?: boolean | undefined;

  buildIndex: number;
  binsDir: string;
  id: ProjectId;
  manifest?: ProjectManifest | undefined;
  originalManifest?: ProjectManifest | undefined;
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  removePackages?: string[] | undefined;
  wantedDependencies?: Array<WantedDependency & WantedExtraProps> | undefined;
};

export type UninstallSomeImporterToUpdate<WantedExtraProps> = {
  mutation: 'uninstallSome';
  dependencyNames: string[];
  targetDependenciesField?: DependenciesField | undefined;

  buildIndex: number;
  binsDir: string;
  id: ProjectId;
  manifest?: ProjectManifest | undefined;
  originalManifest?: ProjectManifest | undefined;
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  pruneDirectDependencies: boolean;
  removePackages?: string[] | undefined;
  updatePackageManifest?: boolean | undefined;
  wantedDependencies?: Array<WantedDependency & WantedExtraProps> | undefined;
};

export type ImporterToUpdate<WantedExtraProps> =
  | InstallImporterToUpdate<WantedExtraProps>
  | InstallSomeImporterToUpdate<WantedExtraProps>
  | UninstallSomeImporterToUpdate<WantedExtraProps>;

export type UpdatedProject = {
  originalManifest?: ProjectManifest | undefined;
  manifest?: ProjectManifest | undefined;
  peerDependencyIssues?: PeerDependencyIssues | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

type InstallFunctionResult = {
  newLockfile: LockfileObject;
  projects: UpdatedProject[];
  stats?: InstallationResultStats | undefined;
  depsRequiringBuild: DepPath[];
  ignoredBuilds?: string[] | undefined;
};

type InstallFunction = (
  projects: ImporterToUpdate<{
    isNew?: boolean | undefined;
    updateSpec?: boolean | undefined;
    preserveNonSemverVersionSpec?: boolean | undefined;
  }>[],
  ctx: OspmContext,
  opts: Omit<StrictInstallOptions, 'patchedDependencies'> & {
    patchedDependencies?: PatchGroupRecord | undefined;
    makePartialCurrentLockfile: boolean;
    needsFullResolution: boolean;
    neverBuiltDependencies?: string[] | undefined;
    onlyBuiltDependencies?: string[] | undefined;
    overrides?: Record<string, string> | undefined;
    updateLockfileMinorVersion: boolean;
    preferredVersions?: PreferredVersions | undefined;
    pruneVirtualStore: boolean;
    scriptsOpts: RunLifecycleHooksConcurrentlyOptions;
    currentLockfileIsUpToDate: boolean;
    hoistWorkspacePackages?: boolean | undefined;
  }
) => Promise<InstallFunctionResult>;

async function _installInContext(
  projects: ImporterToUpdate<{
    isNew?: boolean | undefined;
    updateSpec?: boolean | undefined;
    preserveNonSemverVersionSpec?: boolean | undefined;
  }>[],
  ctx: OspmContext,
  opts: Omit<StrictInstallOptions, 'patchedDependencies'> & {
    patchedDependencies?: PatchGroupRecord | undefined;
    makePartialCurrentLockfile: boolean;
    needsFullResolution: boolean;
    neverBuiltDependencies?: string[] | undefined;
    onlyBuiltDependencies?: string[] | undefined;
    overrides?: Record<string, string> | undefined;
    updateLockfileMinorVersion: boolean;
    preferredVersions?: PreferredVersions | undefined;
    pruneVirtualStore: boolean;
    scriptsOpts: RunLifecycleHooksConcurrentlyOptions;
    currentLockfileIsUpToDate: boolean;
    hoistWorkspacePackages?: boolean | undefined;
  }
): Promise<{
  newLockfile: LockfileObject;
  projects: {
    manifest?: ProjectManifest | undefined;
    peerDependencyIssues?: PeerDependencyIssues | undefined;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  }[];
  stats?: InstallationResultStats | undefined;
  depsRequiringBuild: DepPath[];
  ignoredBuilds?: string[] | undefined;
}> {
  // The wanted lockfile is mutated during installation. To compare changes, a
  // deep copy before installation is needed. This copy should represent the
  // original wanted lockfile on disk as close as possible.
  //
  // This object can be quite large. Intentionally avoiding an expensive copy
  // if no lockfileCheck option was passed in.
  const originalLockfileForCheck =
    opts.lockfileCheck != null ? clone.default(ctx.wantedLockfile) : null;

  // Aliasing for clarity in boolean expressions below.
  const isInstallationOnlyForLockfileCheck = opts.lockfileCheck != null;

  ctx.wantedLockfile.importers = ctx.wantedLockfile.importers || {};

  for (const { id } of projects) {
    if (!ctx.wantedLockfile.importers[id]) {
      ctx.wantedLockfile.importers[id] = { specifiers: {} };
    }
  }

  if (opts.pruneLockfileImporters) {
    const projectIds = new Set(
      projects.map(
        ({
          id,
        }: ImporterToUpdate<{
          isNew?: boolean | undefined;
          updateSpec?: boolean | undefined;
          preserveNonSemverVersionSpec?: boolean | undefined;
        }>): ProjectId => {
          return id;
        }
      )
    );

    for (const wantedImporter of Object.keys(
      ctx.wantedLockfile.importers
    ) as ProjectId[]) {
      if (projectIds.has(wantedImporter) !== true) {
        delete ctx.wantedLockfile.importers[wantedImporter];
      }
    }
  }

  await Promise.all(
    projects.map(
      async (
        project: ImporterToUpdate<{
          isNew?: boolean | undefined;
          updateSpec?: boolean | undefined;
          preserveNonSemverVersionSpec?: boolean | undefined;
        }>
      ): Promise<void> => {
        if (project.mutation !== 'uninstallSome') {
          return;
        }

        const _removeDeps = async (
          manifest: ProjectManifest
        ): Promise<ProjectManifest> => {
          return removeDeps(manifest, project.dependencyNames, {
            prefix: project.rootDir,
            saveType: project.targetDependenciesField,
          });
        };

        if (typeof project.manifest !== 'undefined') {
          project.manifest = await _removeDeps(project.manifest);
        }

        if (typeof project.originalManifest !== 'undefined') {
          project.originalManifest = await _removeDeps(
            project.originalManifest
          );
        }
      }
    )
  );

  stageLogger.debug({
    prefix: ctx.lockfileDir ?? '',
    stage: 'resolution_started',
  });

  const update = projects.some(
    (
      project: ImporterToUpdate<{
        isNew?: boolean | undefined;
        updateSpec?: boolean | undefined;
        preserveNonSemverVersionSpec?: boolean | undefined;
      }>
    ): boolean => {
      return 'update' in project && project.update === true; // as InstallMutationOptions
    }
  );

  const preferredVersions =
    opts.preferredVersions ??
    (update
      ? undefined
      : getPreferredVersionsFromLockfileAndManifests(
          ctx.wantedLockfile.packages,
          Object.values(ctx.projects)
            .map(
              ({
                manifest,
              }: ProjectOptions &
                HookOptions & {
                  binsDir: string;
                }): ProjectManifest | undefined => {
                return manifest;
              }
            )
            .filter(Boolean)
        ));

  const forceFullResolution =
    ctx.wantedLockfile.lockfileVersion !== LOCKFILE_VERSION ||
    !opts.currentLockfileIsUpToDate ||
    opts.force ||
    opts.needsFullResolution ||
    ctx.lockfileHadConflicts ||
    opts.dedupePeerDependents;

  // Ignore some fields when fixing lockfile, so these fields can be regenerated
  // and make sure it's up to date
  if (
    opts.fixLockfile &&
    typeof ctx.wantedLockfile.packages !== 'undefined' &&
    !isEmpty.default(ctx.wantedLockfile.packages)
  ) {
    ctx.wantedLockfile.packages = mapValues.default(
      ({
        dependencies,
        optionalDependencies,
        resolution,
      }): {
        dependencies?: ResolvedDependencies | undefined;
        optionalDependencies?: ResolvedDependencies | undefined;
        resolution?: Resolution | undefined;
      } => {
        return {
          // These fields are needed to avoid losing information of the locked dependencies if these fields are not broken
          // If these fields are broken, they will also be regenerated
          dependencies,
          optionalDependencies,
          resolution,
        };
      },
      ctx.wantedLockfile.packages
    );
  }

  if (opts.dedupe) {
    // Deleting recorded version resolutions from importers and packages. These
    // fields will be regenerated using the preferred versions computed above.
    //
    // This is a bit different from a "full resolution", which completely
    // ignores preferred versions from the lockfile.
    forgetResolutionsOfAllPrevWantedDeps(ctx.wantedLockfile);
  }

  let {
    dependenciesGraph,
    dependenciesByProjectId,
    linkedDependenciesByProjectId,
    newLockfile,
    outdatedDependencies,
    peerDependencyIssuesByProjects,
    wantedToBeSkippedPackageIds,
    waitTillAllFetchingsFinish,
  } = await resolveDependencies(projects, {
    allowUnusedPatches: false,
    allowedDeprecatedVersions: opts.allowedDeprecatedVersions,
    allowNonAppliedPatches: opts.allowNonAppliedPatches,
    autoInstallPeers: opts.autoInstallPeers,
    autoInstallPeersFromHighestMatch: opts.autoInstallPeersFromHighestMatch,
    catalogs: opts.catalogs,
    currentLockfile: ctx.currentLockfile,
    defaultUpdateDepth: opts.depth,
    dedupeDirectDeps: opts.dedupeDirectDeps,
    dedupeInjectedDeps: opts.dedupeInjectedDeps,
    dedupePeerDependents: opts.dedupePeerDependents,
    dryRun: opts.lockfileOnly,
    engineStrict: opts.engineStrict,
    excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
    force: opts.force,
    forceFullResolution,
    ignoreScripts: opts.ignoreScripts,
    hooks: {
      readPackage: opts.readPackageHook,
    },
    linkWorkspacePackagesDepth:
      opts.linkWorkspacePackagesDepth ||
      (opts.saveWorkspaceProtocol === false ? -1 : 0),
    lockfileDir: opts.lockfileDir,
    nodeVersion: opts.nodeVersion,
    ospmVersion:
      opts.packageManager.name === 'ospm' ? opts.packageManager.version : '',
    preferWorkspacePackages: opts.preferWorkspacePackages,
    preferredVersions,
    preserveWorkspaceProtocol: opts.preserveWorkspaceProtocol,
    registries: ctx.registries,
    resolutionMode: opts.resolutionMode,
    saveWorkspaceProtocol: opts.saveWorkspaceProtocol,
    storeController: opts.storeController,
    tag: opts.tag,
    virtualStoreDir: ctx.virtualStoreDir,
    virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
    wantedLockfile: ctx.wantedLockfile,
    workspacePackages: ctx.workspacePackages,
    patchedDependencies: opts.patchedDependencies,
    lockfileIncludeTarballUrl: opts.lockfileIncludeTarballUrl,
    resolvePeersFromWorkspaceRoot: opts.resolvePeersFromWorkspaceRoot,
    supportedArchitectures: opts.supportedArchitectures,
    peersSuffixMaxLength: opts.peersSuffixMaxLength,
    injectWorkspacePackages: opts.injectWorkspacePackages,
  });

  if (
    !opts.include.optionalDependencies ||
    !opts.include.devDependencies ||
    !opts.include.dependencies
  ) {
    linkedDependenciesByProjectId = mapValues.default(
      (linkedDeps: LinkedDependency[]): LinkedDependency[] => {
        return linkedDeps.filter((linkedDep: LinkedDependency): boolean => {
          return !(
            (linkedDep.dev === true && !opts.include.devDependencies) ||
            (linkedDep.optional === true &&
              !opts.include.optionalDependencies) ||
            (linkedDep.dev !== true &&
              linkedDep.optional !== true &&
              opts.include.dependencies !== true)
          );
        });
      },
      linkedDependenciesByProjectId
    );

    for (const { id, manifest } of projects) {
      for (const [alias, depPath] of dependenciesByProjectId[id]?.entries() ??
        []) {
        let include = false;

        const dep = dependenciesGraph[depPath];

        if (typeof dep === 'undefined') {
          include = false;
        } else {
          const isDev = Boolean(manifest?.devDependencies?.[dep.name]);

          const isOptional = Boolean(
            manifest?.optionalDependencies?.[dep.name]
          );

          include = !(
            (isDev && !opts.include.devDependencies) ||
            (isOptional && !opts.include.optionalDependencies) ||
            (!isDev && !isOptional && !opts.include.dependencies)
          );
        }

        if (!include) {
          dependenciesByProjectId[id]?.delete(alias);
        }
      }
    }
  }

  stageLogger.debug({
    prefix: ctx.lockfileDir ?? '',
    stage: 'resolution_done',
  });

  newLockfile =
    typeof opts.hooks.afterAllResolved === 'undefined'
      ? newLockfile
      : pipeWith.default<Array<LockfileObject>, LockfileObject>(
          async (f, res) => {
            return f(await res);
          },
          // TODO: fix this
          opts.hooks.afterAllResolved as [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (...args: LockfileObject[]) => any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...((args: any) => any)[],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (...args: any[]) => LockfileObject,
          ]
        )(newLockfile);

  if (opts.updateLockfileMinorVersion) {
    newLockfile.lockfileVersion = LOCKFILE_VERSION;
  }

  const depsStateCache: DepsStateCache = {};

  const lockfileOpts = {
    useGitBranchLockfile: opts.useGitBranchLockfile,
    mergeGitBranchLockfiles: opts.mergeGitBranchLockfiles,
  };

  let stats: InstallationResultStats | undefined;

  const allowBuild = createAllowBuildFunction({
    neverBuiltDependencies: opts.neverBuiltDependencies ?? [],
    onlyBuiltDependencies: opts.onlyBuiltDependencies ?? [],
    onlyBuiltDependenciesFile: opts.onlyBuiltDependenciesFile ?? '',
  });

  let ignoredBuilds: string[] | undefined;

  if (
    !opts.lockfileOnly &&
    !isInstallationOnlyForLockfileCheck &&
    opts.enableModulesDir
  ) {
    const result = await linkPackages(projects, dependenciesGraph, {
      allowBuild,
      currentLockfile: ctx.currentLockfile,
      dedupeDirectDeps: opts.dedupeDirectDeps,
      dependenciesByProjectId,
      depsStateCache,
      disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
      extraNodePaths: ctx.extraNodePaths,
      force: opts.force,
      hoistedDependencies: ctx.hoistedDependencies,
      hoistedModulesDir: ctx.hoistedModulesDir,
      hoistPattern: ctx.hoistPattern,
      ignoreScripts: opts.ignoreScripts,
      include: opts.include,
      linkedDependenciesByProjectId,
      lockfileDir: opts.lockfileDir,
      makePartialCurrentLockfile: opts.makePartialCurrentLockfile,
      outdatedDependencies,
      pruneStore: opts.pruneStore,
      pruneVirtualStore: opts.pruneVirtualStore,
      publicHoistPattern: ctx.publicHoistPattern,
      registries: ctx.registries,
      rootModulesDir: ctx.rootModulesDir,
      sideEffectsCacheRead: opts.sideEffectsCacheRead,
      symlink: opts.symlink,
      skipped: ctx.skipped,
      storeController: opts.storeController,
      virtualStoreDir: ctx.virtualStoreDir,
      virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
      wantedLockfile: newLockfile,
      wantedToBeSkippedPackageIds,
      hoistWorkspacePackages: opts.hoistWorkspacePackages,
    });

    stats = result.stats;

    if (opts.enablePnp) {
      const importerNames = Object.fromEntries(
        projects.map(
          ({
            manifest,
            id,
          }: ImporterToUpdate<{
            isNew?: boolean | undefined;
            updateSpec?: boolean | undefined;
            preserveNonSemverVersionSpec?: boolean | undefined;
          }>): [ProjectId, string] => {
            return [id, manifest?.name ?? id];
          }
        )
      );
      await writePnpFile(result.currentLockfile, {
        importerNames,
        lockfileDir: ctx.lockfileDir ?? '',
        virtualStoreDir: ctx.virtualStoreDir,
        virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
        registries: ctx.registries,
      });
    }

    ctx.pendingBuilds = ctx.pendingBuilds.filter(
      (relDepPath: string): boolean => {
        return !result.removedDepPaths.has(relDepPath);
      }
    );

    if (result.newDepPaths.length) {
      if (opts.ignoreScripts) {
        // we can use concat here because we always only append new packages, which are guaranteed to not be there by definition
        ctx.pendingBuilds = ctx.pendingBuilds.concat(
          result.newDepPaths.filter((depPath: DepPath): boolean => {
            return dependenciesGraph[depPath]?.requiresBuild === true;
          })
        );
      }

      if (
        !opts.ignoreScripts ||
        Object.keys(opts.patchedDependencies ?? {}).length > 0
      ) {
        // postinstall hooks
        const depPaths = Object.keys(dependenciesGraph) as DepPath[];

        const rootNodes = depPaths.filter((depPath: DepPath): boolean => {
          return dependenciesGraph[depPath]?.depth === 0;
        });

        let extraEnv: Record<string, string> | undefined =
          opts.scriptsOpts.extraEnv;
        if (opts.enablePnp) {
          extraEnv = {
            ...extraEnv,
            ...makeNodeRequireOption(path.join(opts.lockfileDir, '.pnp.cjs')),
          };
        }

        ignoredBuilds = (
          await buildModules(dependenciesGraph, rootNodes, {
            allowBuild,
            ignoredBuiltDependencies: opts.ignoredBuiltDependencies,
            childConcurrency: opts.childConcurrency,
            depsStateCache,
            depsToBuild: new Set(result.newDepPaths),
            extraBinPaths: ctx.extraBinPaths,
            extraNodePaths: ctx.extraNodePaths,
            extraEnv,
            ignoreScripts: opts.ignoreScripts || opts.ignoreDepScripts,
            lockfileDir: ctx.lockfileDir ?? '',
            optional: opts.include.optionalDependencies,
            preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
            rawConfig: opts.rawConfig,
            rootModulesDir: ctx.virtualStoreDir,
            scriptsPrependNodePath: opts.scriptsPrependNodePath,
            scriptShell: opts.scriptShell,
            shellEmulator: opts.shellEmulator,
            sideEffectsCacheWrite: opts.sideEffectsCacheWrite,
            storeController: opts.storeController,
            unsafePerm: opts.unsafePerm,
            userAgent: opts.userAgent,
          })
        ).ignoredBuilds;
      }
    }

    function binWarn(prefix: string, message: string): void {
      logger.info({ message, prefix });
    }

    if (result.newDepPaths.length) {
      const newPkgs = props.default<DepPath, DependenciesGraphNode>(
        result.newDepPaths,
        dependenciesGraph
      );

      await linkAllBins(newPkgs, dependenciesGraph, {
        extraNodePaths: ctx.extraNodePaths,
        optional: opts.include.optionalDependencies,
        warn: binWarn.bind(null, opts.lockfileDir),
      });
    }

    await Promise.all(
      projects.map(
        async (
          project: ImporterToUpdate<{
            isNew?: boolean | undefined;
            updateSpec?: boolean | undefined;
            preserveNonSemverVersionSpec?: boolean | undefined;
          }>,
          index: number
        ): Promise<void> => {
          let linkedPackages!: string[];

          if (
            typeof ctx.publicHoistPattern?.length === 'number' &&
            ctx.publicHoistPattern.length > 0 &&
            path.relative(project.rootDir, opts.lockfileDir) === ''
          ) {
            const nodeExecPathByAlias: Record<string, string> = {};

            for (const alias in project.manifest?.dependenciesMeta) {
              const dm = project.manifest.dependenciesMeta[alias];

              if (typeof dm === 'undefined') {
                continue;
              }

              if (typeof dm.node === 'string') {
                nodeExecPathByAlias[alias] = dm.node;
              }
            }

            if (typeof project.binsDir === 'undefined') {
              project.binsDir = path.join(
                project.rootDir,
                'node_modules',
                '.bin'
              );
            }

            linkedPackages = await linkBins(
              project.modulesDir,
              project.binsDir,
              {
                allowExoticManifests: true,
                preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
                projectManifest: project.manifest,
                nodeExecPathByAlias,
                extraNodePaths: ctx.extraNodePaths,
                warn: binWarn.bind(null, project.rootDir),
              }
            );
          } else {
            const directPkgs = [
              ...props.default<DepPath, DependenciesGraphNode>(
                Array.from(
                  dependenciesByProjectId[project.id]?.values() ?? []
                ).filter((depPath: DepPath): boolean => {
                  return ctx.skipped.has(depPath) !== true;
                }),
                dependenciesGraph
              ),
              ...(linkedDependenciesByProjectId[project.id]?.map(
                ({
                  pkgId,
                }: LinkedDependency): {
                  dir: string;
                  fetching: undefined;
                } => {
                  return {
                    dir: path.join(project.rootDir, pkgId.substring(5)),
                    fetching: undefined,
                  };
                }
              ) ?? []),
            ];

            linkedPackages = await linkBinsOfPackages(
              (
                await Promise.all(
                  directPkgs.map(
                    async (
                      dep:
                        | DependenciesGraphNode
                        | {
                            dir: string;
                            fetching: undefined;
                          }
                    ): Promise<{
                      location: string;
                      manifest: BundledManifest | null;
                      nodeExecPath: string | undefined;
                    }> => {
                      const manifest =
                        (await dep.fetching?.())?.bundledManifest ??
                        (await safeReadProjectManifestOnly(dep.dir));

                      let nodeExecPath: string | undefined;

                      if (typeof manifest?.name === 'string') {
                        nodeExecPath =
                          project.manifest?.dependenciesMeta?.[manifest.name]
                            ?.node;
                      }

                      return {
                        location: dep.dir,
                        manifest,
                        nodeExecPath,
                      };
                    }
                  )
                )
              ).filter(
                ({
                  manifest,
                }: {
                  location: string;
                  manifest: BundledManifest | null;
                  nodeExecPath: string | undefined;
                }): boolean => {
                  return manifest !== null;
                }
              ) as Array<{
                location: string;
                // filtered out null manifests
                manifest: BundledManifest;
                nodeExecPath: string | undefined;
              }>,
              project.binsDir,
              {
                extraNodePaths: ctx.extraNodePaths,
                preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
              }
            );
          }

          const projectToInstall = projects[index];

          if (
            opts.global &&
            projectToInstall?.mutation.includes('install') === true
          ) {
            for (const pkg of projectToInstall.wantedDependencies ?? []) {
              // This warning is never printed currently during "ospm link --global"
              // due to the following issue: https://github.com/ospm/ospm/issues/4761
              if (
                typeof pkg.alias === 'string' &&
                !linkedPackages.includes(pkg.alias)
              ) {
                logger.warn({
                  message: `${pkg.alias} has no binaries`,
                  prefix: opts.lockfileDir,
                });
              }
            }
          }
        }
      )
    );

    const projectsWithTargetDirs = extendProjectsWithTargetDirs(
      projects,
      newLockfile,
      {
        virtualStoreDir: ctx.virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      }
    );

    await Promise.all([
      opts.useLockfile && opts.saveLockfile
        ? writeLockfiles({
            currentLockfile: result.currentLockfile,
            currentLockfileDir: ctx.virtualStoreDir,
            wantedLockfile: newLockfile,
            wantedLockfileDir: ctx.lockfileDir ?? '',
            ...lockfileOpts,
          })
        : writeCurrentLockfile(ctx.virtualStoreDir, result.currentLockfile),
      (async (): Promise<void> => {
        if (
          result.currentLockfile.packages === undefined &&
          result.removedDepPaths.size === 0
        ) {
          return Promise.resolve();
        }

        const injectedDeps: Record<string, string[]> = {};

        for (const project of projectsWithTargetDirs) {
          if (project.targetDirs.length > 0) {
            injectedDeps[project.id] = project.targetDirs.map(
              (targetDir: string): string => {
                return path.relative(opts.lockfileDir, targetDir);
              }
            );
          }
        }

        return writeModulesManifest(
          ctx.rootModulesDir,
          {
            ...ctx.modulesFile,
            hoistedDependencies: result.newHoistedDependencies,
            hoistPattern: ctx.hoistPattern,
            included: ctx.include,
            injectedDeps,
            ignoredBuilds,
            layoutVersion: LAYOUT_VERSION,
            nodeLinker: opts.nodeLinker,
            packageManager: `${opts.packageManager.name}@${opts.packageManager.version}`,
            pendingBuilds: ctx.pendingBuilds,
            publicHoistPattern: ctx.publicHoistPattern,
            prunedAt:
              opts.pruneVirtualStore || ctx.modulesFile == null
                ? new Date().toUTCString()
                : ctx.modulesFile.prunedAt,
            registries: ctx.registries,
            skipped: Array.from(ctx.skipped),
            storeDir: ctx.storeDir,
            virtualStoreDir: ctx.virtualStoreDir,
            virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
          },
          {
            makeModulesDir:
              Object.keys(result.currentLockfile.packages ?? {}).length > 0,
          }
        );
      })(),
    ]);

    if (!opts.ignoreScripts) {
      if (opts.enablePnp) {
        opts.scriptsOpts.extraEnv = {
          ...opts.scriptsOpts.extraEnv,
          ...makeNodeRequireOption(path.join(opts.lockfileDir, '.pnp.cjs')),
        };
      }

      const projectsToBeBuilt: ProjectToBeInstalled[] =
        projectsWithTargetDirs.filter(
          ({
            mutation,
          }: ImporterToUpdate<{
            isNew?: boolean | undefined;
            updateSpec?: boolean | undefined;
            preserveNonSemverVersionSpec?: boolean | undefined;
          }> & {
            id: ProjectId;
            stages: string[];
            targetDirs: string[];
          }): boolean => {
            return mutation === 'install';
          }
        ); //  as ProjectToBeInstalled[]

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
        opts.childConcurrency,
        opts.scriptsOpts
      );
    }
  } else {
    if (
      opts.useLockfile &&
      opts.saveLockfile &&
      !isInstallationOnlyForLockfileCheck
    ) {
      await writeWantedLockfile(
        ctx.lockfileDir ?? '',
        newLockfile,
        lockfileOpts
      );
    }

    if (opts.nodeLinker !== 'hoisted') {
      // This is only needed because otherwise the reporter will hang
      stageLogger.debug({
        prefix: opts.lockfileDir,
        stage: 'importing_done',
      });
    }
  }

  await waitTillAllFetchingsFinish();

  const depsRequiringBuild: DepPath[] = [];

  if (opts.returnListOfDepsRequiringBuild === true) {
    await Promise.all(
      Object.entries(dependenciesGraph).map(
        async ([depPath, node]: [
          string,
          ResolvedPackage & GenericDependenciesGraphNodeWithResolvedChildren,
        ]): Promise<void> => {
          // We cannot detect if a skipped optional dependency requires build
          if (typeof node.fetching === 'undefined') {
            return;
          }

          const { files } = await node.fetching();

          if (files.requiresBuild) {
            depsRequiringBuild.push(depPath as DepPath);
          }
        }
      )
    );
  }

  reportPeerDependencyIssues(peerDependencyIssuesByProjects, {
    lockfileDir: opts.lockfileDir,
    strictPeerDependencies: opts.strictPeerDependencies,
  });

  summaryLogger.debug({ prefix: opts.lockfileDir });

  // Similar to the sequencing for when the original wanted lockfile is
  // copied, the new lockfile passed here should be as close as possible to
  // what will eventually be written to disk. Ex: peers should be resolved,
  // the afterAllResolved hook has been applied, etc.
  if (originalLockfileForCheck != null) {
    opts.lockfileCheck?.(originalLockfileForCheck, newLockfile);
  }

  return {
    newLockfile,
    projects: projects.map(
      ({
        id,
        manifest,
        rootDir,
      }): {
        manifest?: ProjectManifest | undefined;
        peerDependencyIssues: PeerDependencyIssues | undefined;
        rootDir:
          | ProjectRootDir
          | ProjectRootDirRealPath
          | GlobalPkgDir
          | WorkspaceDir
          | LockFileDir;
      } => {
        return {
          manifest,
          peerDependencyIssues: peerDependencyIssuesByProjects[id],
          rootDir,
        };
      }
    ),
    stats,
    depsRequiringBuild,
    ignoredBuilds,
  };
}

function allMutationsAreInstalls(projects: MutatedProject[]): boolean {
  return projects.every((project: MutatedProject): boolean => {
    return (
      project.mutation === 'install' &&
      project.update !== true &&
      !project.updateMatching
    );
  });
}

const limitLinking = pLimit(16);

async function linkAllBins(
  depNodes: DependenciesGraphNode[],
  depGraph: DependenciesGraph,
  opts: {
    extraNodePaths?: string[] | undefined;
    preferSymlinkedExecutables?: boolean | undefined;
    optional: boolean;
    warn: (message: string) => void;
  }
): Promise<void> {
  await Promise.all(
    depNodes.map(async (depNode: DependenciesGraphNode): Promise<void> => {
      return limitLinking(async (): Promise<void> => {
        return linkBinsOfDependencies(depNode, depGraph, opts);
      });
    })
  );
}
