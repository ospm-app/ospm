import { getPreferredVersionsFromLockfileAndManifests } from '../lockfile.preferred-versions/index.ts';
import {
  resolveDependencies,
  getWantedDependencies,
  type WantedDependency,
} from '../resolve-dependencies/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  PeerDependencyIssuesByProjects,
  ProjectManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import {
  getContext,
  type HookOptions,
  type ProjectOptions,
  type GetContextOptions,
} from '../get-context/index.ts';
import { createReadPackageHook } from '../hooks.read-package-hook/index.ts';
import { DEFAULT_REGISTRIES } from '../normalize-registries/index.ts';
import { parseOverrides } from '../parse-overrides/index.ts';
import type { InstallOptions } from './install/extendInstallOptions.ts';

export type ListMissingPeersOptions = Partial<GetContextOptions> &
  Pick<
    InstallOptions,
    | 'hooks'
    | 'catalogs'
    | 'dedupePeerDependents'
    | 'ignoreCompatibilityDb'
    | 'linkWorkspacePackagesDepth'
    | 'nodeVersion'
    | 'nodeLinker'
    | 'overrides'
    | 'packageExtensions'
    | 'ignoredOptionalDependencies'
    | 'preferWorkspacePackages'
    | 'saveWorkspaceProtocol'
    | 'storeController'
    | 'useGitBranchLockfile'
    | 'peersSuffixMaxLength'
  > &
  Partial<Pick<InstallOptions, 'supportedArchitectures'>> &
  Pick<
    GetContextOptions,
    'autoInstallPeers' | 'excludeLinksFromLockfile' | 'storeDir'
  > &
  Required<
    Pick<InstallOptions, 'virtualStoreDirMaxLength' | 'peersSuffixMaxLength'>
  >;

export type RequiredDefined<T> = { [P in keyof T]-?: Exclude<T[P], undefined> };

export async function getPeerDependencyIssues(
  projects: (ProjectOptions & HookOptions & { binsDir: string })[],
  opts: ListMissingPeersOptions
): Promise<PeerDependencyIssuesByProjects> {
  const lockfileDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir = opts.lockfileDir ?? (process.cwd() as LockFileDir);

  const ctx = await getContext({
    force: false,
    extraBinPaths: [],
    lockfileDir,
    registries: DEFAULT_REGISTRIES,
    useLockfile: true,
    allProjects: projects,
    ...opts,
    nodeLinker: opts.nodeLinker ?? 'isolated',
  });

  const projectsToResolve = Object.values(ctx.projects)
    .map(
      (
        project: ProjectOptions & HookOptions & { binsDir: string }
      ):
        | (ProjectOptions &
            HookOptions & {
              binsDir: string;
              updatePackageManifest?: boolean | undefined;
              wantedDependencies: Array<WantedDependency>;
            })
        | undefined => {
        if (typeof project.manifest === 'undefined') {
          return undefined;
        }

        return {
          ...project,
          updatePackageManifest: false,
          wantedDependencies: getWantedDependencies(project.manifest, opts),
        };
      }
    )
    .filter(Boolean);

  const preferredVersions = getPreferredVersionsFromLockfileAndManifests(
    ctx.wantedLockfile.packages,
    Object.values(ctx.projects)
      .map(
        ({
          manifest,
        }: ProjectOptions & HookOptions): ProjectManifest | undefined => {
          return manifest;
        }
      )
      .filter(Boolean)
  );

  const overrides = parseOverrides(opts.overrides ?? {}, opts.catalogs ?? {});

  const { peerDependencyIssuesByProjects, waitTillAllFetchingsFinish } =
    await resolveDependencies(projectsToResolve, {
      currentLockfile: ctx.currentLockfile,
      allowedDeprecatedVersions: {},
      allowNonAppliedPatches: false,
      allowUnusedPatches: false,
      catalogs: opts.catalogs,
      defaultUpdateDepth: -1,
      dedupePeerDependents: opts.dedupePeerDependents,
      dryRun: true,
      engineStrict: false,
      force: false,
      forceFullResolution: true,
      hooks: {
        readPackage: createReadPackageHook({
          ignoreCompatibilityDb: opts.ignoreCompatibilityDb,
          lockfileDir,
          overrides,
          packageExtensions: opts.packageExtensions,
          readPackageHook: opts.hooks?.readPackage,
          ignoredOptionalDependencies: opts.ignoredOptionalDependencies,
        }),
      },
      linkWorkspacePackagesDepth:
        opts.linkWorkspacePackagesDepth ??
        (opts.saveWorkspaceProtocol !== false &&
        typeof opts.saveWorkspaceProtocol !== 'undefined'
          ? 0
          : -1),
      lockfileDir,
      nodeVersion: opts.nodeVersion ?? process.version,
      pnpmVersion: '',
      preferWorkspacePackages: opts.preferWorkspacePackages,
      preferredVersions,
      preserveWorkspaceProtocol: false,
      registries: ctx.registries,
      saveWorkspaceProtocol: false, // this doesn't matter in our case. We won't write changes to package.json files
      storeController: opts.storeController,
      tag: 'latest',
      virtualStoreDir: ctx.virtualStoreDir,
      virtualStoreDirMaxLength: ctx.virtualStoreDirMaxLength,
      wantedLockfile: ctx.wantedLockfile,
      workspacePackages: ctx.workspacePackages,
      supportedArchitectures: opts.supportedArchitectures,
      peersSuffixMaxLength: opts.peersSuffixMaxLength,
    });

  await waitTillAllFetchingsFinish();

  return peerDependencyIssuesByProjects;
}
