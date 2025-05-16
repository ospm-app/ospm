import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import equals from 'ramda/src/equals';
import isEmpty from 'ramda/src/isEmpty';
import filter from 'ramda/src/filter';
import once from 'ramda/src/once';
import type { Config } from '../config/index.ts';
import { MANIFEST_BASE_NAMES, WANTED_LOCKFILE } from '../constants/index.ts';
import { hashObjectNullableWithPrefix } from '../crypto.object-hasher/index.ts';
import { OspmError } from '../error/index.ts';
import { arrayOfWorkspacePackagesToMap } from '../get-context/index.ts';
import {
  getLockfileImporterId,
  readCurrentLockfile,
  readWantedLockfile,
} from '../lockfile.fs/index.ts';
import {
  calcPatchHashes,
  createOverridesMapFromParsed,
  getOutdatedLockfileSetting,
} from '../lockfile.settings-checker/index.ts';
import {
  linkedPackagesAreUpToDate,
  getWorkspacePackagesByDirectory,
  satisfiesPackageManifest,
} from '../lockfile.verification/index.ts';
import { globalWarn, logger } from '../logger/index.ts';
import { parseOverrides } from '../parse-overrides/index.ts';
import { getOspmfilePath } from '../pnpmfile/index.ts';
import type { WorkspacePackages } from '../resolver-base/index.ts';
import type {
  DependencyManifest,
  GlobalPkgDir,
  LockFileDir,
  Project,
  ProjectId,
  ProjectManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import { findWorkspacePackages } from '../workspace.find-packages/index.ts';
import { readWorkspaceManifest } from '../workspace.read-manifest/index.ts';
import {
  type WorkspaceState,
  type WorkspaceStateSettings,
  loadWorkspaceState,
  updateWorkspaceState,
} from '../workspace.state/index.ts';
import { assertLockfilesEqual } from './assertLockfilesEqual.ts';
import { safeStat, safeStatSync } from './safeStat.ts';
import { statManifestFile } from './statManifestFile.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { getOptionsFromRootManifest, type OptionsFromRootManifest } from '../config/getOptionsFromRootManifest.ts';

export type CheckDepsStatusOptions = Pick<
  Config,
  | 'allProjects'
  | 'autoInstallPeers'
  | 'catalogs'
  | 'excludeLinksFromLockfile'
  | 'injectWorkspacePackages'
  | 'linkWorkspacePackages'
  | 'hooks'
  | 'peersSuffixMaxLength'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
  | 'sharedWorkspaceLockfile'
  | 'virtualStoreDir'
  | 'workspaceDir'
  | 'patchesDir'
  | 'ospmfile'
  | 'configDependencies'
> & {
  ignoreFilteredInstallCache?: boolean;
  ignoredWorkspaceStateSettings?: Array<keyof WorkspaceStateSettings>;
} & WorkspaceStateSettings;

export interface CheckDepsStatusResult {
  upToDate: boolean | undefined;
  issue?: string | undefined;
  workspaceState: WorkspaceState | undefined;
}

export async function checkDepsStatus(
  opts: CheckDepsStatusOptions
): Promise<CheckDepsStatusResult> {
  const workspaceState = loadWorkspaceState(
    opts.workspaceDir ?? opts.rootProjectManifestDir
  );
  if (!workspaceState) {
    return {
      upToDate: false,
      issue: 'Cannot check whether dependencies are outdated',
      workspaceState,
    };
  }
  try {
    return await _checkDepsStatus(opts, workspaceState);
  } catch (error) {
    if (
      util.types.isNativeError(error) &&
      'code' in error &&
      String(error.code).startsWith('ERR_OSPM_RUN_CHECK_DEPS_')
    ) {
      return {
        upToDate: false,
        issue: error.message,
        workspaceState,
      };
    }
    // This function never throws an error.
    // We want to ensure that ospm CLI never crashes when checking the status of dependencies.
    // In the worst-case scenario, the install will run redundantly.
    return {
      upToDate: undefined,
      issue: util.types.isNativeError(error) ? error.message : undefined,
      workspaceState,
    };
  }
}

async function _checkDepsStatus(
  opts: CheckDepsStatusOptions,
  workspaceState?: WorkspaceState | undefined
): Promise<CheckDepsStatusResult> {
  const {
    allProjects,
    autoInstallPeers,
    injectWorkspacePackages,
    catalogs,
    excludeLinksFromLockfile,
    linkWorkspacePackages,
    rootProjectManifest,
    rootProjectManifestDir,
    sharedWorkspaceLockfile,
    workspaceDir,
  } = opts;

  const rootManifestOptions = rootProjectManifest
    ? getOptionsFromRootManifest(rootProjectManifestDir, rootProjectManifest)
    : undefined;

  if (
    opts.ignoreFilteredInstallCache === true &&
    typeof workspaceState?.filteredInstall !== 'undefined'
  ) {
    return { upToDate: undefined, workspaceState };
  }

  if (typeof workspaceState?.settings !== 'undefined') {
    const ignoredSettings = new Set<keyof WorkspaceStateSettings>(
      opts.ignoredWorkspaceStateSettings
    );

    ignoredSettings.add('catalogs'); // 'catalogs' is always ignored

    for (const [settingName, settingValue] of Object.entries(
      workspaceState.settings
    )) {
      if (ignoredSettings.has(settingName as keyof WorkspaceStateSettings))
        continue;
      if (
        !equals.default(
          settingValue,
          opts[settingName as keyof WorkspaceStateSettings]
        )
      ) {
        return {
          upToDate: false,
          issue: `The value of the ${settingName} setting has changed`,
          workspaceState,
        };
      }
    }
  }

  if (
    (opts.configDependencies != null ||
      typeof workspaceState?.configDependencies !== 'undefined') &&
    !equals.default(
      opts.configDependencies ?? {},
      workspaceState?.configDependencies ?? {}
    )
  ) {
    return {
      upToDate: false,
      issue: 'Configuration dependencies are not up to date',
      workspaceState,
    };
  }

  if (allProjects && typeof workspaceDir === 'string' && workspaceDir !== '') {
    if (
      !equals.default(
        filter.default(
          (value) => value != null,
          workspaceState?.settings.catalogs ?? {}
        ),
        filter.default((value) => value != null, catalogs ?? {})
      )
    ) {
      return {
        upToDate: false,
        issue: 'Catalogs cache outdated',
        workspaceState,
      };
    }

    if (
      allProjects.length !==
        Object.keys(workspaceState?.projects ?? {}).length ||
      !allProjects.every((currentProject: Project): boolean => {
        const prevProject = workspaceState?.projects[currentProject.rootDir];

        if (typeof prevProject === 'undefined') {
          return false;
        }

        return (
          prevProject.name === currentProject.manifest.name &&
          (prevProject.version ?? '0.0.0') === currentProject.manifest.version
        );
      })
    ) {
      return {
        upToDate: false,
        issue: 'The workspace structure has changed since last install',
        workspaceState,
      };
    }

    const allManifestStats = await Promise.all(
      allProjects.map(
        async (
          project: Project
        ): Promise<{
          project: Project;
          manifestStats: fs.Stats;
          modulesDirStats: fs.Stats | undefined;
        }> => {
          const modulesDirStatsPromise = safeStat(
            path.join(project.rootDir, 'node_modules')
          );

          const manifestStats = await statManifestFile(project.rootDir);

          if (typeof manifestStats === 'undefined') {
            // this error should not happen
            throw new Error(
              `Cannot find one of ${MANIFEST_BASE_NAMES.join(', ')} in ${project.rootDir}`
            );
          }

          return {
            project,
            manifestStats,
            modulesDirStats: await modulesDirStatsPromise,
          };
        }
      )
    );

    if (typeof workspaceState?.filteredInstall === 'undefined') {
      for (const { modulesDirStats, project } of allManifestStats) {
        if (modulesDirStats) {
          continue;
        }

        if (
          isEmpty.default({
            ...project.manifest.dependencies,
            ...project.manifest.devDependencies,
          })
        ) {
          continue;
        }

        const id = project.manifest.name || project.rootDir;

        return {
          upToDate: false,
          issue: `Workspace package ${id} has dependencies but does not have a modules directory`,
          workspaceState,
        };
      }
    }

    const modifiedProjects = allManifestStats.filter(
      ({
        manifestStats,
      }: {
        project: Project;
        manifestStats: fs.Stats;
        modulesDirStats: fs.Stats | undefined;
      }): boolean => {
        return (
          manifestStats.mtime.valueOf() >
          (workspaceState?.lastValidatedTimestamp ?? 0)
        );
      }
    );

    if (modifiedProjects.length === 0) {
      logger.debug({
        msg: 'No manifest files were modified since the last validation. Exiting check.',
      });

      return { upToDate: true, workspaceState };
    }

    const issue = await patchesAreModified({
      rootManifestOptions,
      rootDir: rootProjectManifestDir,
      lastValidatedTimestamp: workspaceState?.lastValidatedTimestamp,
      ospmfile: opts.ospmfile,
      hadOspmfile: workspaceState?.ospmfileExists,
    });

    if (typeof issue === 'string' && issue !== '') {
      return { upToDate: false, issue, workspaceState };
    }

    logger.debug({
      msg: 'Some manifest files were modified since the last validation. Continuing check.',
    });

    let readWantedLockfileAndDir: (projectDir: string) => Promise<{
      wantedLockfile: LockfileObject;
      wantedLockfileDir: string;
    }>;

    if (sharedWorkspaceLockfile === true) {
      let wantedLockfileStats: fs.Stats;

      try {
        wantedLockfileStats = fs.statSync(
          path.join(workspaceDir, WANTED_LOCKFILE)
        );
      } catch (error) {
        if (
          util.types.isNativeError(error) &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return throwLockfileNotFound(workspaceDir);
        }

        throw error;
      }

      const wantedLockfilePromise = readWantedLockfile(workspaceDir, {
        ignoreIncompatible: false,
      });

      if (
        wantedLockfileStats.mtime.valueOf() >
        (workspaceState?.lastValidatedTimestamp ?? 0)
      ) {
        const virtualStoreDir =
          opts.virtualStoreDir ??
          path.join(workspaceDir, 'node_modules', '.ospm');

        const currentLockfile = await readCurrentLockfile(virtualStoreDir, {
          ignoreIncompatible: false,
        });

        const wantedLockfile =
          (await wantedLockfilePromise) ?? throwLockfileNotFound(workspaceDir);

        assertLockfilesEqual(currentLockfile, wantedLockfile, workspaceDir);
      }

      readWantedLockfileAndDir = async (): Promise<{
        wantedLockfile: LockfileObject;
        wantedLockfileDir: string;
      }> => {
        return {
          wantedLockfile:
            (await wantedLockfilePromise) ??
            throwLockfileNotFound(workspaceDir),
          wantedLockfileDir: workspaceDir,
        };
      };
    } else {
      readWantedLockfileAndDir = async (
        wantedLockfileDir: string
      ): Promise<{
        wantedLockfile: LockfileObject;
        wantedLockfileDir: string;
      }> => {
        const wantedLockfilePromise = readWantedLockfile(wantedLockfileDir, {
          ignoreIncompatible: false,
        });

        const wantedLockfileStats = await safeStat(
          path.join(wantedLockfileDir, WANTED_LOCKFILE)
        );

        if (typeof wantedLockfileStats === 'undefined') {
          return throwLockfileNotFound(wantedLockfileDir);
        }

        if (
          wantedLockfileStats.mtime.valueOf() >
          (workspaceState?.lastValidatedTimestamp ?? 0)
        ) {
          const virtualStoreDir =
            opts.virtualStoreDir ??
            path.join(wantedLockfileDir, 'node_modules', '.ospm');

          const currentLockfile = await readCurrentLockfile(virtualStoreDir, {
            ignoreIncompatible: false,
          });

          const wantedLockfile =
            (await wantedLockfilePromise) ??
            throwLockfileNotFound(wantedLockfileDir);

          assertLockfilesEqual(
            currentLockfile,
            wantedLockfile,
            wantedLockfileDir
          );
        }

        return {
          wantedLockfile:
            (await wantedLockfilePromise) ??
            throwLockfileNotFound(wantedLockfileDir),
          wantedLockfileDir,
        };
      };
    }

    type GetProjectId = (project: Pick<Project, 'rootDir'>) => ProjectId;

    const getProjectId: GetProjectId =
      sharedWorkspaceLockfile === true
        ? (project: Pick<Project, 'rootDir'>): ProjectId => {
            return getLockfileImporterId(workspaceDir, project.rootDir);
          }
        : (): ProjectId => {
            return '.' as ProjectId;
          };

    const getWorkspacePackages = once.default(
      arrayOfWorkspacePackagesToMap.bind(null, allProjects)
    );

    const getManifestsByDir = once.default(
      (): Record<string, DependencyManifest> => {
        return getWorkspacePackagesByDirectory(getWorkspacePackages());
      }
    );

    const assertCtx: AssertWantedLockfileUpToDateContext = {
      autoInstallPeers,
      injectWorkspacePackages,
      config: opts,
      excludeLinksFromLockfile,
      linkWorkspacePackages,
      getManifestsByDir,
      getWorkspacePackages,
      rootDir: workspaceDir,
      rootManifestOptions,
    };

    try {
      await Promise.all(
        modifiedProjects.map(
          async ({
            project,
          }: {
            project: Project;
            manifestStats: fs.Stats;
            modulesDirStats: fs.Stats | undefined;
          }): Promise<void> => {
            const { wantedLockfile, wantedLockfileDir } =
              await readWantedLockfileAndDir(project.rootDir);

            await assertWantedLockfileUpToDate(assertCtx, {
              projectDir: project.rootDir,
              projectId: getProjectId(project),
              projectManifest: project.manifest,
              wantedLockfile,
              wantedLockfileDir,
            });
          }
        )
      );
    } catch (err) {
      return {
        upToDate: false,
        issue:
          util.types.isNativeError(err) && 'message' in err
            ? err.message
            : undefined,
        workspaceState,
      };
    }

    // update lastValidatedTimestamp to prevent pointless repeat
    await updateWorkspaceState({
      allProjects,
      workspaceDir,
      ospmfileExists: workspaceState?.ospmfileExists,
      settings: opts,
      filteredInstall: workspaceState?.filteredInstall,
    });

    return { upToDate: true, workspaceState };
  }

  if (typeof allProjects === 'undefined') {
    const workspaceRoot = workspaceDir ?? rootProjectManifestDir;

    const workspaceManifest = await readWorkspaceManifest(workspaceRoot);

    if (typeof (workspaceManifest ?? workspaceDir) === 'undefined') {
      const allProjects = await findWorkspacePackages(rootProjectManifestDir, {
        patterns: workspaceManifest?.packages,
        sharedWorkspaceLockfile,
      });

      return checkDepsStatus({
        ...opts,
        allProjects,
      });
    }
  } else {
    // this error shouldn't happen
    throw new Error(
      'Impossible variant: allProjects is defined but workspaceDir is undefined'
    );
  }

  if (typeof rootProjectManifest !== 'undefined') {
    const virtualStoreDir = path.join(
      rootProjectManifestDir,
      'node_modules',
      '.ospm'
    );

    const currentLockfilePromise = readCurrentLockfile(virtualStoreDir, {
      ignoreIncompatible: false,
    });

    const wantedLockfilePromise = readWantedLockfile(rootProjectManifestDir, {
      ignoreIncompatible: false,
    });

    const [currentLockfileStats, wantedLockfileStats, manifestStats] =
      await Promise.all([
        safeStat(path.join(virtualStoreDir, 'lock.yaml')),
        safeStat(path.join(rootProjectManifestDir, WANTED_LOCKFILE)),
        statManifestFile(rootProjectManifestDir),
      ]);

    if (!wantedLockfileStats) {
      return throwLockfileNotFound(rootProjectManifestDir);
    }

    const issue = await patchesAreModified({
      rootManifestOptions,
      rootDir: rootProjectManifestDir,
      lastValidatedTimestamp: wantedLockfileStats.mtime.valueOf(),
      ospmfile: opts.ospmfile,
      hadOspmfile: workspaceState?.ospmfileExists,
    });

    if (typeof issue !== 'undefined') {
      return { upToDate: false, issue, workspaceState };
    }

    if (
      currentLockfileStats &&
      wantedLockfileStats.mtime.valueOf() > currentLockfileStats.mtime.valueOf()
    ) {
      const currentLockfile = await currentLockfilePromise;

      const wantedLockfile =
        (await wantedLockfilePromise) ??
        throwLockfileNotFound(rootProjectManifestDir);

      assertLockfilesEqual(
        currentLockfile,
        wantedLockfile,
        rootProjectManifestDir
      );
    }

    if (!manifestStats) {
      // this error should not happen
      throw new Error(
        `Cannot find one of ${MANIFEST_BASE_NAMES.join(', ')} in ${rootProjectManifestDir}`
      );
    }

    if (manifestStats.mtime.valueOf() > wantedLockfileStats.mtime.valueOf()) {
      logger.debug({
        msg: 'The manifest is newer than the lockfile. Continuing check.',
      });

      try {
        await assertWantedLockfileUpToDate(
          {
            autoInstallPeers,
            injectWorkspacePackages,
            config: opts,
            excludeLinksFromLockfile,
            linkWorkspacePackages,
            getManifestsByDir: () => ({}),
            getWorkspacePackages: () => undefined,
            rootDir: rootProjectManifestDir,
            rootManifestOptions,
          },
          {
            projectDir: rootProjectManifestDir,
            projectId: '.' as ProjectId,
            projectManifest: rootProjectManifest,
            wantedLockfile:
              (await wantedLockfilePromise) ??
              throwLockfileNotFound(rootProjectManifestDir),
            wantedLockfileDir: rootProjectManifestDir,
          }
        );
      } catch (err) {
        return {
          upToDate: false,
          issue:
            util.types.isNativeError(err) && 'message' in err
              ? err.message
              : undefined,
          workspaceState,
        };
      }
    } else if (currentLockfileStats) {
      logger.debug({
        msg: 'The manifest file is not newer than the lockfile. Exiting check.',
      });
    } else {
      const wantedLockfile =
        (await wantedLockfilePromise) ??
        throwLockfileNotFound(rootProjectManifestDir);

      if (!isEmpty.default(wantedLockfile.packages ?? {})) {
        throw new OspmError(
          'RUN_CHECK_DEPS_NO_DEPS',
          'The lockfile requires dependencies but none were installed',
          {
            hint: 'Run `ospm install` to install dependencies',
          }
        );
      }
    }

    return { upToDate: true, workspaceState };
  }

  // `opts.allProject` being `undefined` means that the run command was not run with `--recursive`.
  // `rootProjectManifest` being `undefined` means that there's no root manifest.
  // Both means that `ospm run` would fail, so checking lockfiles here is pointless.
  globalWarn('Skipping check.');

  return { upToDate: undefined, workspaceState };
}

type AssertWantedLockfileUpToDateContext = {
  autoInstallPeers?: boolean | undefined;
  config: CheckDepsStatusOptions;
  excludeLinksFromLockfile?: boolean | undefined;
  injectWorkspacePackages?: boolean | undefined;
  linkWorkspacePackages: boolean | 'deep';
  getManifestsByDir: () => Record<string, DependencyManifest>;
  getWorkspacePackages: () => WorkspacePackages | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  rootManifestOptions?: OptionsFromRootManifest | undefined;
};

interface AssertWantedLockfileUpToDateOptions {
  projectDir: string;
  projectId: ProjectId;
  projectManifest: ProjectManifest;
  wantedLockfile: LockfileObject;
  wantedLockfileDir: string;
}

async function assertWantedLockfileUpToDate(
  ctx: AssertWantedLockfileUpToDateContext,
  opts: AssertWantedLockfileUpToDateOptions
): Promise<void> {
  const {
    autoInstallPeers,
    config,
    excludeLinksFromLockfile,
    linkWorkspacePackages,
    getManifestsByDir,
    getWorkspacePackages,
    rootDir,
    rootManifestOptions,
  } = ctx;

  const {
    projectDir,
    projectId,
    projectManifest,
    wantedLockfile,
    wantedLockfileDir,
  } = opts;

  const [patchedDependencies, ospmfileChecksum] = await Promise.all([
    calcPatchHashes(rootManifestOptions?.patchedDependencies ?? {}, rootDir),
    config.hooks?.calculateOspmfileChecksum?.(),
  ]);

  const outdatedLockfileSettingName = getOutdatedLockfileSetting(
    wantedLockfile,
    {
      autoInstallPeers: config.autoInstallPeers,
      injectWorkspacePackages: config.injectWorkspacePackages,
      excludeLinksFromLockfile: config.excludeLinksFromLockfile,
      peersSuffixMaxLength: config.peersSuffixMaxLength,
      overrides: createOverridesMapFromParsed(
        parseOverrides(rootManifestOptions?.overrides ?? {}, config.catalogs)
      ),
      ignoredOptionalDependencies:
        rootManifestOptions?.ignoredOptionalDependencies?.sort(),
      packageExtensionsChecksum: hashObjectNullableWithPrefix(
        rootManifestOptions?.packageExtensions
      ),
      patchedDependencies,
      ospmfileChecksum,
    }
  );

  if (outdatedLockfileSettingName) {
    throw new OspmError(
      'RUN_CHECK_DEPS_OUTDATED_LOCKFILE',
      `Setting ${outdatedLockfileSettingName} of lockfile in ${wantedLockfileDir} is outdated`,
      {
        hint: 'Run `ospm install` to update the lockfile',
      }
    );
  }

  if (
    !satisfiesPackageManifest(
      {
        autoInstallPeers,
        excludeLinksFromLockfile,
      },
      wantedLockfile.importers?.[projectId],
      projectManifest
    ).satisfies
  ) {
    throw new OspmError(
      'RUN_CHECK_DEPS_UNSATISFIED_PKG_MANIFEST',
      `The lockfile in ${wantedLockfileDir} does not satisfy project of id ${projectId}`,
      {
        hint: 'Run `ospm install` to update the lockfile',
      }
    );
  }

  if (
    !(await linkedPackagesAreUpToDate(
      {
        linkWorkspacePackages: linkWorkspacePackages !== false,
        lockfileDir: wantedLockfileDir,
        manifestsByDir: getManifestsByDir(),
        workspacePackages: getWorkspacePackages(),
        lockfilePackages: wantedLockfile.packages,
      },
      {
        dir: projectDir,
        manifest: projectManifest,
        snapshot: wantedLockfile.importers?.[projectId],
      }
    ))
  ) {
    throw new OspmError(
      'RUN_CHECK_DEPS_LINKED_PKGS_OUTDATED',
      `The linked packages by ${projectDir} is outdated`,
      {
        hint: 'Run `ospm install` to update the packages',
      }
    );
  }
}

function throwLockfileNotFound(wantedLockfileDir: string): never {
  throw new OspmError(
    'RUN_CHECK_DEPS_LOCKFILE_NOT_FOUND',
    `Cannot find a lockfile in ${wantedLockfileDir}`,
    {
      hint: 'Run `ospm install` to create the lockfile',
    }
  );
}

async function patchesAreModified(opts: {
  rootManifestOptions: OptionsFromRootManifest | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  lastValidatedTimestamp?: number | undefined;
  ospmfile: string;
  hadOspmfile?: boolean | undefined;
}): Promise<string | undefined> {
  if (opts.rootManifestOptions?.patchedDependencies) {
    const allPatchStats = await Promise.all(
      Object.values(opts.rootManifestOptions.patchedDependencies).map(
        (patchFile: string): Promise<fs.Stats | undefined> => {
          return safeStat(path.relative(opts.rootDir, patchFile));
        }
      )
    );

    if (
      allPatchStats.some((patch: fs.Stats | undefined): boolean => {
        return (
          (patch ? patch.mtime.valueOf() : 0) >
          (opts.lastValidatedTimestamp ?? 0)
        );
      })
    ) {
      return 'Patches were modified';
    }
  }

  const ospmfilePath = getOspmfilePath(opts.rootDir, opts.ospmfile);

  const ospmfileStats = safeStatSync(ospmfilePath);
  if (
    ospmfileStats != null &&
    ospmfileStats.mtime.valueOf() > (opts.lastValidatedTimestamp ?? 0)
  ) {
    return `ospmfile at "${ospmfilePath}" was modified`;
  }

  if (opts.hadOspmfile === true && ospmfileStats == null) {
    return `ospmfile at "${ospmfilePath}" was removed`;
  }

  if (opts.hadOspmfile !== true && typeof ospmfileStats !== 'undefined') {
    return `ospmfile at "${ospmfilePath}" was added`;
  }

  return undefined;
}
