import path from 'node:path';
import {
  readProjectManifestOnly,
  tryReadProjectManifest,
} from '../cli-utils/index.ts';
import type { Config } from '../config/index.ts';
import { checkDepsStatus } from '../deps.status/index.ts';
import { OspmError } from '../error/index.ts';
import { arrayOfWorkspacePackagesToMap } from '../get-context/index.ts';
import { filterPkgsBySelectorObjects } from '../filter-workspace-packages/index.ts';
import { filterDependenciesByType } from '../manifest-utils/index.ts';
import { findWorkspacePackages } from '../workspace.find-packages/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { rebuildProjects } from '../plugin-commands-rebuild/index.ts';
import { requireHooks } from '../pnpmfile/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type {
  IncludedDependencies,
  Project,
  ProjectsGraph,
  ProjectRootDir,
  PrepareExecutionEnv,
  ModulesDir,
  ProjectId,
  WorkspaceDir,
} from '../types/index.ts';
import {
  install,
  mutateModulesInSingleProject,
  type MutateModulesOptions,
  type WorkspacePackages,
} from '../core/index.ts';
import { globalInfo, logger } from '../logger/index.ts';
import { sequenceGraph } from '../sort-packages/index.ts';
import { createPkgGraph } from '../workspace.pkgs-graph/index.ts';
import {
  updateWorkspaceState,
  type WorkspaceStateSettings,
} from '../workspace.state/index.ts';
import isSubdir from 'is-subdir';
import { IgnoredBuildsError } from './errors.ts';
import { getPinnedVersion } from './getPinnedVersion.ts';
import { getSaveType } from './getSaveType.ts';
import { getNodeExecPath } from './nodeExecPath.ts';
import {
  type CommandFullName,
  type RecursiveOptions,
  type UpdateDepsMatcher,
  createMatcher,
  matchDependencies,
  makeIgnorePatterns,
  recursive,
} from './recursive.ts';
import {
  createWorkspaceSpecs,
  updateToWorkspacePackagesFromManifest,
} from './updateWorkspaceDependencies.ts';
import { installConfigDeps } from './installConfigDeps.ts';
import type { Catalog } from '../catalogs.types/index.ts';
import { getOptionsFromRootManifest } from '../config/getOptionsFromRootManifest.ts';

const OVERWRITE_UPDATE_OPTIONS = {
  allowNew: true,
  update: false,
};

export type InstallDepsOptions = Pick<
  Config,
  | 'allProjects'
  | 'allProjectsGraph'
  | 'autoInstallPeers'
  | 'bail'
  | 'bin'
  | 'catalogs'
  | 'cliOptions'
  | 'dedupePeerDependents'
  | 'depth'
  | 'dev'
  | 'engineStrict'
  | 'excludeLinksFromLockfile'
  | 'global'
  | 'globalOspmfile'
  | 'hooks'
  | 'ignoreCurrentPrefs'
  | 'ignoreOspmfile'
  | 'ignoreScripts'
  | 'optimisticRepeatInstall'
  | 'linkWorkspacePackages'
  | 'lockfileDir'
  | 'lockfileOnly'
  | 'ospmfile'
  | 'production'
  | 'preferWorkspacePackages'
  | 'rawLocalConfig'
  | 'registries'
  | 'rootProjectManifestDir'
  | 'rootProjectManifest'
  | 'save'
  | 'saveDev'
  | 'saveExact'
  | 'saveOptional'
  | 'savePeer'
  | 'savePrefix'
  | 'saveProd'
  | 'saveWorkspaceProtocol'
  | 'lockfileIncludeTarballUrl'
  | 'scriptsPrependNodePath'
  | 'scriptShell'
  | 'selectedProjectsGraph'
  | 'sideEffectsCache'
  | 'sideEffectsCacheReadonly'
  | 'sort'
  | 'sharedWorkspaceLockfile'
  | 'shellEmulator'
  | 'tag'
  | 'optional'
  | 'workspaceConcurrency'
  | 'workspaceDir'
  | 'workspacePackagePatterns'
  | 'extraEnv'
  | 'ignoreWorkspaceCycles'
  | 'disallowWorkspaceCycles'
  | 'configDependencies'
> &
  CreateStoreControllerOptions & {
    argv: {
      original: string[];
    };
    allowNew?: boolean | undefined;
    forceFullResolution?: boolean | undefined;
    frozenLockfileIfExists?: boolean | undefined;
    include?: IncludedDependencies | undefined;
    includeDirect?: IncludedDependencies | undefined;
    latest?: boolean | undefined;
    /**
     * If specified, the installation will only be performed for comparison of the
     * wanted lockfile. The wanted lockfile will not be updated on disk and no
     * modules will be linked.
     *
     * The given callback is passed the wanted lockfile before installation and
     * after. This allows functions to reasonably determine whether the wanted
     * lockfile will change on disk after installation. The lockfile arguments
     * passed to this callback should not be mutated.
     */
    lockfileCheck?:
      | ((prev: LockfileObject, next: LockfileObject) => void)
      | undefined;
    update?: boolean;
    updateToLatest?: boolean | undefined;
    updateMatching?: ((pkgName: string) => boolean) | undefined;
    updatePackageManifest?: boolean | undefined;
    useBetaCli?: boolean | undefined;
    recursive?: boolean | undefined;
    dedupe?: boolean | undefined;
    workspace?: boolean | undefined;
    includeOnlyPackageFiles?: boolean | undefined;
    prepareExecutionEnv: PrepareExecutionEnv;
    fetchFullMetadata?: boolean | undefined;
  } & Partial<Pick<Config, 'ospmHomeDir' | 'strictDepBuilds'>>;

export async function installDeps(
  opts: InstallDepsOptions,
  params: string[]
): Promise<void> {
  let newParams = params;

  if (
    opts.update !== true &&
    opts.dedupe !== true &&
    newParams.length === 0 &&
    opts.optimisticRepeatInstall === true
  ) {
    const { upToDate } = await checkDepsStatus({
      ...opts,
      ignoreFilteredInstallCache: true,
    });

    if (upToDate === true) {
      globalInfo('Already up to date');
      return;
    }
  }
  if (opts.workspace === true) {
    if (opts.latest === true) {
      throw new OspmError(
        'BAD_OPTIONS',
        'Cannot use --latest with --workspace simultaneously'
      );
    }
    if (typeof opts.workspaceDir === 'undefined') {
      throw new OspmError(
        'WORKSPACE_OPTION_OUTSIDE_WORKSPACE',
        '--workspace can only be used inside a workspace'
      );
    }

    if (
      opts.linkWorkspacePackages === false &&
      (opts.saveWorkspaceProtocol === false ||
        typeof opts.saveWorkspaceProtocol === 'undefined')
    ) {
      if (opts.rawLocalConfig['save-workspace-protocol'] === false) {
        throw new OspmError(
          'BAD_OPTIONS',
          "This workspace has link-workspace-packages turned off, \
so dependencies are linked from the workspace only when the workspace protocol is used. \
Either set link-workspace-packages to true or don't use the --no-save-workspace-protocol option \
when running add/update with the --workspace option"
        );
      }

      opts.saveWorkspaceProtocol = true;
    }

    // biome-ignore lint/complexity/noExtraBooleanCast: <explanation>
    opts.saveWorkspaceProtocol = !Boolean(opts.linkWorkspacePackages);
  }

  let store = await createOrConnectStoreController(opts);

  if (opts.configDependencies) {
    await installConfigDeps(opts.configDependencies, {
      registries: opts.registries,
      rootDir: opts.lockfileDir, // ?? opts.rootProjectManifestDir,
      store: store.ctrl,
    });
  }

  if (opts.ignoreOspmfile !== true && !opts.hooks) {
    opts.hooks = requireHooks(opts.lockfileDir, opts); //  ?? opts.dir

    if (opts.hooks.fetchers != null || opts.hooks.importPackage != null) {
      store = await createOrConnectStoreController(opts);
    }
  }

  const includeDirect = opts.includeDirect ?? {
    dependencies: true,
    devDependencies: true,
    optionalDependencies: true,
  };

  const forceHoistPattern =
    typeof opts.rawLocalConfig['hoist-pattern'] !== 'undefined' ||
    typeof opts.rawLocalConfig['hoist'] !== 'undefined';

  const forcePublicHoistPattern =
    typeof opts.rawLocalConfig['shamefully-hoist'] !== 'undefined' ||
    typeof opts.rawLocalConfig['public-hoist-pattern'] !== 'undefined';

  const allProjects =
    opts.allProjects ??
    (typeof opts.workspaceDir === 'string'
      ? await findWorkspacePackages(opts.workspaceDir, {
          ...opts,
          patterns: opts.workspacePackagePatterns,
        })
      : []);

  if (typeof opts.workspaceDir === 'string') {
    const selectedProjectsGraph =
      opts.selectedProjectsGraph ?? selectProjectByDir(allProjects, opts.dir);

    if (selectedProjectsGraph != null) {
      const sequencedGraph = sequenceGraph(selectedProjectsGraph);

      // Check and warn if there are cyclic dependencies
      if (opts.ignoreWorkspaceCycles !== true && sequencedGraph.safe !== true) {
        const cyclicDependenciesInfo =
          sequencedGraph.cycles.length > 0
            ? `: ${sequencedGraph.cycles.map((deps) => deps.join(', ')).join('; ')}`
            : '';

        if (opts.disallowWorkspaceCycles === true) {
          throw new OspmError(
            'DISALLOW_WORKSPACE_CYCLES',
            `There are cyclic workspace dependencies${cyclicDependenciesInfo}`
          );
        }

        logger.warn({
          message: `There are cyclic workspace dependencies${cyclicDependenciesInfo}`,
          prefix: opts.workspaceDir,
        });
      }

      const didUserConfigureCatalogs = Object.values(opts.catalogs ?? {}).some(
        (catalog: Catalog | undefined): boolean => {
          return Object.keys(catalog ?? {}).length > 0;
        }
      );

      // ospm catalogs and dedupe-peer-dependents are features that require the
      // allProjectsGraph to contain all projects to correctly update the wanted
      // lockfile. Otherwise the wanted lockfile would be partially updated for
      // only the selected projects specified for the filtered install.
      //
      // This should still be performance since only dependencies for the
      // selectedProjectsGraph are installed. The allProjectsGraph is only used
      // to compute the wanted lockfile.
      let allProjectsGraph: ProjectsGraph | undefined;

      if (didUserConfigureCatalogs || opts.dedupePeerDependents === true) {
        allProjectsGraph =
          opts.allProjectsGraph ??
          createPkgGraph(allProjects, {
            linkWorkspacePackages: Boolean(opts.linkWorkspacePackages),
          }).graph;
      } else {
        allProjectsGraph = selectedProjectsGraph;

        if (
          typeof allProjectsGraph[
            opts.workspaceDir as unknown as keyof typeof allProjectsGraph
          ] === 'undefined'
        ) {
          allProjectsGraph = {
            ...allProjectsGraph,
            ...selectProjectByDir(allProjects, opts.workspaceDir),
          };
        }
      }
      await recursiveInstallThenUpdateWorkspaceState(
        allProjects,
        newParams,
        {
          ...opts,
          ...getOptionsFromRootManifest(
            opts.rootProjectManifestDir,
            opts.rootProjectManifest
          ),
          forceHoistPattern,
          forcePublicHoistPattern,
          allProjectsGraph,
          selectedProjectsGraph,
          storeControllerAndDir: store,
          workspaceDir: opts.workspaceDir,
        },
        opts.update === true
          ? 'update'
          : newParams.length === 0
            ? 'install'
            : 'add'
      );
      return;
    }
  }

  // `ospm install ""` is going to be just `ospm install`
  newParams = newParams.filter(Boolean);

  const dir = opts.dir;

  let workspacePackages: WorkspacePackages | undefined;

  if (typeof opts.workspaceDir === 'string') {
    workspacePackages = arrayOfWorkspacePackagesToMap(
      allProjects
    ) as WorkspacePackages;
  }

  const { manifest, writeProjectManifest } = await tryReadProjectManifest(
    opts.dir,
    opts
  );

  if (manifest === null) {
    if (opts.update === true || newParams.length === 0) {
      throw new OspmError(
        'NO_PKG_MANIFEST',
        `No package.json found in ${opts.dir}`
      );
    }

    return;
  }

  const rootManifestOptions = getOptionsFromRootManifest(
    opts.dir,
    opts.dir === opts.rootProjectManifestDir
      ? (opts.rootProjectManifest ?? manifest)
      : manifest
  );

  const installOpts: Omit<MutateModulesOptions, 'allProjects'> = {
    ...opts,
    tag: opts.tag ?? 'latest',
    nodeVersion: opts.nodeVersion ?? 'system',
    lockfileDir: opts.lockfileDir, // ?? (opts.dir as LockFileDir),
    resolutionMode: opts.resolutionMode ?? 'highest',
    userAgent: opts.userAgent ?? 'ospm',
    saveWorkspaceProtocol:
      typeof opts.saveWorkspaceProtocol === 'undefined'
        ? false
        : opts.saveWorkspaceProtocol,
    frozenLockfileIfExists: opts.frozenLockfileIfExists ?? false,
    scriptsPrependNodePath: opts.scriptsPrependNodePath ?? false,
    lockfileIncludeTarballUrl: opts.lockfileIncludeTarballUrl ?? false,
    lockfileOnly: opts.lockfileOnly ?? false,
    ignoreCurrentPrefs: opts.ignoreCurrentPrefs ?? false,
    ignoreOspmfile: opts.ignoreOspmfile ?? false,
    shellEmulator: opts.shellEmulator ?? false,
    ignoreWorkspaceCycles: opts.ignoreWorkspaceCycles ?? false,
    disallowWorkspaceCycles: opts.disallowWorkspaceCycles ?? false,
    force: opts.force ?? false,
    unsafePerm: opts.unsafePerm ?? false,
    resolveSymlinksInInjectedDirs: opts.resolveSymlinksInInjectedDirs ?? false,
    forceFullResolution: opts.forceFullResolution ?? false,
    dedupe: opts.dedupe ?? false,
    include: opts.include ?? {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    includeDirect: opts.includeDirect ?? {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    update: opts.update ?? false,
    ...rootManifestOptions,
    hooks: {
      ...opts.hooks,
      afterAllResolved: opts.hooks?.afterAllResolved ?? [],
    },
    packageExtensions: rootManifestOptions.packageExtensions ?? {},
    allowNonAppliedPatches: rootManifestOptions.allowNonAppliedPatches ?? false,
    ignoredOptionalDependencies:
      rootManifestOptions.ignoredOptionalDependencies ?? [],
    overrides: rootManifestOptions.overrides ?? {},
    allowedDeprecatedVersions:
      rootManifestOptions.allowedDeprecatedVersions ?? {},
    autoInstallPeers: opts.autoInstallPeers ?? false,
    forceHoistPattern,
    forcePublicHoistPattern,
    // In case installation is done in a multi-package repository
    // The dependencies should be built first,
    // so ignoring scripts for now
    ignoreScripts:
      typeof workspacePackages !== 'undefined' || opts.ignoreScripts === true,
    linkWorkspacePackagesDepth:
      opts.linkWorkspacePackages === 'deep'
        ? Number.POSITIVE_INFINITY
        : opts.linkWorkspacePackages
          ? 0
          : -1,
    sideEffectsCacheRead:
      opts.sideEffectsCache ?? opts.sideEffectsCacheReadonly ?? false,
    sideEffectsCacheWrite: opts.sideEffectsCache ?? false,
    storeController: store.ctrl,
    storeDir: store.dir,
    workspacePackages,
    catalogs: opts.catalogs ?? {},
    dedupePeerDependents: opts.dedupePeerDependents ?? false,
    depth: opts.depth ?? 0,
    engineStrict: opts.engineStrict ?? false,
    // excludeLinksFromLockfile: opts.excludeLinksFromLockfile ?? false,
    global: opts.global ?? false,
    // ignoreCurrentPrefs: opts.ignoreCurrentPrefs ?? false,
    // ignoreOspmfile: opts.ignoreOspmfile ?? false,
  } satisfies Omit<MutateModulesOptions, 'allProjects'>;

  if (opts.global === true) {
    const nodeExecPath = await getNodeExecPath();

    if (isSubdir(opts.ospmHomeDir, nodeExecPath)) {
      installOpts.nodeExecPath = nodeExecPath;
    }
  }

  let updateMatch: UpdateDepsMatcher | null;

  if (opts.update === true) {
    if (newParams.length === 0) {
      const ignoreDeps = manifest.ospm?.updateConfig?.ignoreDependencies;

      if (typeof ignoreDeps?.length === 'number' && ignoreDeps.length > 0) {
        newParams = makeIgnorePatterns(ignoreDeps);
      }
    }

    updateMatch = newParams.length ? createMatcher(newParams) : null;
  } else {
    updateMatch = null;
  }

  if (updateMatch !== null) {
    newParams = matchDependencies(updateMatch, manifest, includeDirect);

    if (newParams.length === 0) {
      if (opts.latest === true) {
        return;
      }

      if (opts.depth === 0) {
        throw new OspmError(
          'NO_PACKAGE_IN_DEPENDENCIES',
          'None of the specified packages were found in the dependencies.'
        );
      }
    }
  }

  if (opts.update === true && opts.latest === true && newParams.length === 0) {
    newParams = Object.keys(filterDependenciesByType(manifest, includeDirect));
  }

  if (opts.workspace === true && typeof workspacePackages !== 'undefined') {
    if (newParams.length === 0) {
      newParams = updateToWorkspacePackagesFromManifest(
        manifest,
        includeDirect,
        workspacePackages
      );
    } else {
      newParams = createWorkspaceSpecs(newParams, workspacePackages);
    }
  }

  if (newParams.length) {
    const mutatedProject = {
      allowNew: opts.allowNew,
      binsDir: opts.bin,
      dependencySelectors: newParams,
      manifest,
      mutation: 'installSome' as const,
      peer: opts.savePeer,
      pinnedVersion: getPinnedVersion(opts),
      rootDir: opts.dir as ProjectRootDir,
      targetDependenciesField: getSaveType(opts),
    };

    const { updatedProject, ignoredBuilds } =
      await mutateModulesInSingleProject(mutatedProject, installOpts);

    if (
      opts.save !== false &&
      typeof updatedProject?.manifest !== 'undefined'
    ) {
      await writeProjectManifest(updatedProject.manifest);
    }

    if (opts.lockfileOnly !== true) {
      await updateWorkspaceState({
        allProjects,
        settings: opts,
        workspaceDir:
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          opts.workspaceDir ??
          (opts.lockfileDir as unknown as WorkspaceDir) ??
          (opts.dir as WorkspaceDir),
        ospmfileExists: opts.hooks?.calculateOspmfileChecksum != null,
        filteredInstall:
          allProjects.length !==
          Object.keys(opts.selectedProjectsGraph ?? {}).length,
        configDependencies: opts.configDependencies,
      });
    }
    if (
      opts.strictDepBuilds === true &&
      typeof ignoredBuilds?.length === 'number' &&
      ignoredBuilds.length > 0
    ) {
      throw new IgnoredBuildsError(ignoredBuilds);
    }
    return;
  }

  const { updatedManifest, ignoredBuilds } = await install(manifest, {
    ...installOpts,
    binsDir: opts.bin,
    hooks: {
      ...installOpts.hooks,
    },
  });

  if (
    opts.update === true &&
    opts.save !== false &&
    typeof updatedManifest !== 'undefined'
  ) {
    await writeProjectManifest(updatedManifest);
  }

  if (
    opts.strictDepBuilds === true &&
    typeof ignoredBuilds?.length === 'number' &&
    ignoredBuilds.length > 0
  ) {
    throw new IgnoredBuildsError(ignoredBuilds);
  }

  if (
    opts.linkWorkspacePackages !== false &&
    typeof opts.workspaceDir === 'string'
  ) {
    const { selectedProjectsGraph } = await filterPkgsBySelectorObjects(
      allProjects,
      [
        {
          excludeSelf: true,
          includeDependencies: true,
          parentDir: dir,
        },
      ],
      {
        workspaceDir: opts.workspaceDir,
      }
    );
    await recursiveInstallThenUpdateWorkspaceState(
      allProjects,
      [],
      {
        ...opts,
        ...OVERWRITE_UPDATE_OPTIONS,
        allProjectsGraph: opts.allProjectsGraph,
        selectedProjectsGraph,
        workspaceDir: opts.workspaceDir, // Otherwise TypeScript doesn't understand that is not undefined
      },
      'install'
    );

    if (opts.ignoreScripts === true) return;

    await rebuildProjects(
      [
        {
          // TODO: fix id
          id: '' as ProjectId,
          // TODO: fix modulesDir
          modulesDir: 'node_modules' as ModulesDir,
          // TODO: fix binsDir
          binsDir: '',
          buildIndex: 0,
          manifest: await readProjectManifestOnly(opts.dir, opts),
          rootDir: opts.dir as ProjectRootDir,
        },
      ],
      {
        ...opts,
        production: opts.production ?? false,
        optional: opts.optional ?? false,
        rootProjectManifest: opts.rootProjectManifest ?? manifest,
        pending: true,
        storeController: store.ctrl,
        storeDir: store.dir,
        skipIfHasSideEffectsCache: true,
      }
    );
  } else {
    if (opts.lockfileOnly !== true) {
      await updateWorkspaceState({
        allProjects,
        settings: opts,

        workspaceDir:
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          opts.workspaceDir ??
          (opts.lockfileDir as unknown as WorkspaceDir) ??
          (opts.dir as WorkspaceDir),
        ospmfileExists: opts.hooks?.calculateOspmfileChecksum != null,
        filteredInstall:
          allProjects.length !==
          Object.keys(opts.selectedProjectsGraph ?? {}).length,
        configDependencies: opts.configDependencies,
      });
    }
  }
}

function selectProjectByDir(
  projects: Project[],
  searchedDir: string
): ProjectsGraph | undefined {
  const project = projects.find(({ rootDir }: Project): boolean => {
    return path.relative(rootDir, searchedDir) === '';
  });

  if (project == null) {
    return undefined;
  }

  return { [searchedDir]: { dependencies: [], package: project } };
}

async function recursiveInstallThenUpdateWorkspaceState(
  allProjects: Project[],
  params: string[],
  opts: RecursiveOptions & WorkspaceStateSettings,
  cmdFullName: CommandFullName
): Promise<boolean | string> {
  const recursiveResult = await recursive(
    allProjects,
    params,
    opts,
    cmdFullName
  );

  if (opts.lockfileOnly !== true && typeof opts.workspaceDir === 'string') {
    await updateWorkspaceState({
      allProjects,
      settings: opts,
      workspaceDir: opts.workspaceDir,
      ospmfileExists: opts.hooks?.calculateOspmfileChecksum != null,
      filteredInstall:
        allProjects.length !== Object.keys(opts.selectedProjectsGraph).length,
      configDependencies: opts.configDependencies,
    });
  }

  return recursiveResult;
}
