import { promises as fs } from 'node:fs';
import path from 'node:path';
import { contextLogger, packageManifestLogger } from '../core-loggers/index.ts';
import type { IncludedDependencies, Modules } from '../modules-yaml/index.ts';
import { readProjectsContext } from '../read-projects-context/index.ts';
import type { WorkspacePackages } from '../resolver-base/index.ts';
import type {
  DepPath,
  HoistedDependencies,
  ProjectManifest,
  ReadPackageHook,
  Registries,
  ProjectRootDir,
  ProjectRootDirRealPath,
  ProjectId,
  ModulesDir,
  GlobalPkgDir,
  WorkspaceDir,
  LockFileDir,
} from '../types/index.ts';
import pathAbsolute from 'path-absolute';
import clone from 'ramda/src/clone';
import { readLockfiles } from './readLockfiles.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';

/**
 * Note that some fields are affected by modules directory state. Such fields should be used for
 * mutating the modules directory only or in a manner that does not influence dependency resolution.
 */
export type OspmContext = {
  currentLockfile: LockfileObject;
  currentLockfileIsUpToDate: boolean;
  existsCurrentLockfile: boolean;
  existsWantedLockfile: boolean;
  existsNonEmptyWantedLockfile: boolean;
  extraBinPaths: string[];
  /** Affected by existing modules directory, if it exists. */
  extraNodePaths: string[];
  lockfileHadConflicts: boolean;
  hoistedDependencies: HoistedDependencies;
  /** Required included dependencies or dependencies currently included by the modules directory. */
  include: IncludedDependencies;
  modulesFile: Modules | null;
  pendingBuilds: string[];
  projects: Record<string, ProjectOptions & HookOptions & { binsDir: string }>;
  rootModulesDir: ModulesDir;
  hoistPattern: string[] | undefined;
  /** As applied to existing modules directory, if it exists. */
  currentHoistPattern: string[] | undefined;
  hoistedModulesDir: ModulesDir;
  publicHoistPattern: string[] | undefined;
  /** As applied to existing modules directory, if it exists. */
  currentPublicHoistPattern: string[] | undefined;
  lockfileDir?: LockFileDir | undefined;
  virtualStoreDir: string;
  /** As applied to existing modules directory, otherwise options. */
  virtualStoreDirMaxLength: number;
  /** As applied to existing modules directory, if it exists. */
  skipped: Set<DepPath>;
  storeDir: string;
  wantedLockfile: LockfileObject;
  wantedLockfileIsModified: boolean;
  workspacePackages: WorkspacePackages;
  registries: Registries;
};

export type ProjectOptions = {
  id: ProjectId;
  buildIndex: number;
  // binsDir?: string | undefined;
  manifest?: ProjectManifest | undefined;
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;

  rootDirRealPath?: ProjectRootDirRealPath | undefined;
};

export type HookOptions = {
  originalManifest?: ProjectManifest | undefined;
};

export type GetContextOptions = {
  autoInstallPeers?: boolean | undefined;
  excludeLinksFromLockfile?: boolean | undefined;
  peersSuffixMaxLength?: number | undefined;
  allProjects: Array<ProjectOptions & HookOptions & { binsDir: string }>;
  confirmModulesPurge?: boolean | undefined;
  force?: boolean | undefined;
  frozenLockfile?: boolean | undefined;
  extraBinPaths?: string[] | undefined;
  extendNodePath?: boolean | undefined;
  lockfileDir: LockFileDir;
  modulesDir?: ModulesDir | undefined;
  nodeLinker?: 'isolated' | 'hoisted' | 'pnp' | undefined;
  readPackageHook?: ReadPackageHook | undefined;
  include?: IncludedDependencies | undefined;
  registries: Registries;
  storeDir: string;
  useLockfile: boolean;
  useGitBranchLockfile?: boolean | undefined;
  mergeGitBranchLockfiles?: boolean | undefined;
  virtualStoreDir?: string | undefined;
  virtualStoreDirMaxLength?: number | undefined;
  workspacePackages?: WorkspacePackages | undefined;

  hoistPattern?: string[] | undefined;
  forceHoistPattern?: boolean | undefined;

  publicHoistPattern?: string[] | undefined;
  forcePublicHoistPattern?: boolean | undefined;
  global?: boolean | undefined;
};

export async function getContext(
  opts: GetContextOptions
): Promise<OspmContext> {
  const modulesDir = opts.modulesDir ?? 'node_modules';

  const importersContext = await readProjectsContext(opts.allProjects, {
    lockfileDir: opts.lockfileDir,
    modulesDir,
  });

  const virtualStoreDir = pathAbsolute(
    opts.virtualStoreDir ?? path.join(modulesDir, '.ospm'),
    opts.lockfileDir
  );

  await fs.mkdir(opts.storeDir, { recursive: true });

  for (const project of opts.allProjects) {
    packageManifestLogger.debug({
      initial: project.manifest,
      prefix: project.rootDir,
    });
  }

  if (typeof opts.readPackageHook !== 'undefined') {
    await Promise.all(
      importersContext.projects.map(
        async (project: ProjectOptions & HookOptions): Promise<void> => {
          project.originalManifest = project.manifest;

          if (typeof opts.readPackageHook === 'function') {
            const cm = clone.default(project.manifest);

            if (typeof cm !== 'undefined') {
              project.manifest = await opts.readPackageHook(
                cm,
                project.rootDir
              );
            }
          }
        }
      )
    );
  }

  const extraBinPaths = [...(opts.extraBinPaths || [])];

  const hoistedModulesDir: ModulesDir = path.join(
    virtualStoreDir,
    'node_modules'
  ) as ModulesDir;

  if (
    typeof opts.hoistPattern?.length === 'number' &&
    opts.hoistPattern.length > 0
  ) {
    extraBinPaths.unshift(path.join(hoistedModulesDir, '.bin'));
  }

  const ctx: OspmContext = {
    extraBinPaths,
    extraNodePaths: getExtraNodePaths({
      extendNodePath: opts.extendNodePath,
      nodeLinker: opts.nodeLinker,
      hoistPattern: importersContext.currentHoistPattern ?? opts.hoistPattern,
      virtualStoreDir,
    }),
    hoistedDependencies: importersContext.hoistedDependencies,
    hoistedModulesDir,
    hoistPattern: opts.hoistPattern,
    currentHoistPattern: importersContext.currentHoistPattern,
    include: opts.include ?? importersContext.include,
    lockfileDir: opts.lockfileDir,
    modulesFile: importersContext.modules,
    pendingBuilds: importersContext.pendingBuilds,
    projects: Object.fromEntries(
      importersContext.projects.map(
        (
          project: ProjectOptions & HookOptions & { binsDir: string }
        ): [
          (
            | ProjectRootDir
            | ProjectRootDirRealPath
            | GlobalPkgDir
            | WorkspaceDir
            | LockFileDir
          ),
          ProjectOptions & HookOptions & { binsDir: string },
        ] => {
          return [project.rootDir, project];
        }
      )
    ),
    publicHoistPattern: opts.publicHoistPattern,
    currentPublicHoistPattern: importersContext.currentPublicHoistPattern,
    registries: opts.registries,
    rootModulesDir: importersContext.rootModulesDir,
    skipped: importersContext.skipped,
    storeDir: opts.storeDir,
    virtualStoreDir,
    virtualStoreDirMaxLength:
      importersContext.virtualStoreDirMaxLength ??
      opts.virtualStoreDirMaxLength ??
      0,
    workspacePackages:
      opts.workspacePackages ?? arrayOfWorkspacePackagesToMap(opts.allProjects),
    ...(await readLockfiles({
      autoInstallPeers: opts.autoInstallPeers,
      excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
      peersSuffixMaxLength: opts.peersSuffixMaxLength,
      force: opts.force,
      frozenLockfile: opts.frozenLockfile === true,
      lockfileDir: opts.lockfileDir,
      projects: importersContext.projects,
      registry: opts.registries.default,
      useLockfile: opts.useLockfile,
      useGitBranchLockfile: opts.useGitBranchLockfile,
      mergeGitBranchLockfiles: opts.mergeGitBranchLockfiles,
      virtualStoreDir,
    })),
  };

  contextLogger.debug({
    currentLockfileExists: ctx.existsCurrentLockfile,
    storeDir: opts.storeDir,
    virtualStoreDir,
  });

  return ctx;
}

export interface OspmSingleContext {
  currentLockfile: LockfileObject;
  currentLockfileIsUpToDate: boolean;
  existsCurrentLockfile: boolean;
  existsWantedLockfile: boolean;
  existsNonEmptyWantedLockfile: boolean;
  /** Affected by existing modules directory, if it exists. */
  extraBinPaths: string[];
  extraNodePaths: string[];
  lockfileHadConflicts: boolean;
  hoistedDependencies: HoistedDependencies;
  hoistedModulesDir: string;
  hoistPattern: string[] | undefined;
  manifest: ProjectManifest;
  modulesDir?: string | undefined;
  importerId: string;
  prefix: string;
  /** Required included dependencies or dependencies currently included by the modules directory. */
  include: IncludedDependencies;
  modulesFile: Modules | null;
  pendingBuilds: string[];
  publicHoistPattern: string[] | undefined;
  registries: Registries;
  rootModulesDir: string;
  lockfileDir: string;
  virtualStoreDir: string;
  /** As applied to existing modules directory, if it exists. */
  skipped: Set<string>;
  storeDir: string;
  wantedLockfile: LockfileObject;
  wantedLockfileIsModified: boolean;
}

export async function getContextForSingleImporter(
  manifest: ProjectManifest,
  opts: {
    autoInstallPeers: boolean;
    excludeLinksFromLockfile: boolean;
    peersSuffixMaxLength: number;
    force: boolean;
    confirmModulesPurge?: boolean | undefined;
    extraBinPaths?: string[] | undefined;
    extendNodePath?: boolean | undefined;
    lockfileDir: LockFileDir;
    nodeLinker: 'isolated' | 'hoisted' | 'pnp';
    modulesDir: ModulesDir;
    readPackageHook?: ReadPackageHook | undefined;
    include?: IncludedDependencies | undefined;
    dir: string;
    registries: Registries;
    storeDir: string;
    useLockfile: boolean;
    useGitBranchLockfile?: boolean | undefined;
    mergeGitBranchLockfiles?: boolean | undefined;
    virtualStoreDir?: string | undefined;
    virtualStoreDirMaxLength: number;

    hoistPattern?: string[] | undefined;
    forceHoistPattern?: boolean | undefined;

    publicHoistPattern?: string[] | undefined;
    forcePublicHoistPattern?: boolean | undefined;
  }
): Promise<OspmSingleContext> {
  const {
    currentHoistPattern,
    hoistedDependencies,
    projects,
    include,
    modules,
    pendingBuilds,
    registries,
    skipped,
    rootModulesDir,
  } = await readProjectsContext(
    [
      {
        // TODO: fix id
        id: '' as ProjectId,
        // TODO: fix buildIndex
        buildIndex: 0,
        // TODO: fix binsDir
        binsDir: '',
        manifest,
        rootDir: opts.dir as ProjectRootDir,
        modulesDir: opts.modulesDir,
      },
    ],
    {
      lockfileDir: opts.lockfileDir,
      modulesDir: opts.modulesDir,
    }
  );

  const storeDir = opts.storeDir;

  const importer = projects[0];

  const modulesDir = importer?.modulesDir;

  const importerId = importer?.id;

  if (typeof importerId !== 'string') {
    throw new Error('importerId is required');
  }

  const virtualStoreDir = pathAbsolute(
    opts.virtualStoreDir ?? 'node_modules/.ospm',
    opts.lockfileDir
  );

  await fs.mkdir(storeDir, { recursive: true });

  const extraBinPaths = [...(opts.extraBinPaths || [])];

  const hoistedModulesDir = path.join(virtualStoreDir, 'node_modules');

  if (
    typeof opts.hoistPattern?.length === 'number' &&
    opts.hoistPattern.length > 0
  ) {
    extraBinPaths.unshift(path.join(hoistedModulesDir, '.bin'));
  }

  const ctx: OspmSingleContext = {
    extraBinPaths,
    extraNodePaths: getExtraNodePaths({
      extendNodePath: opts.extendNodePath,
      nodeLinker: opts.nodeLinker,
      hoistPattern: currentHoistPattern ?? opts.hoistPattern,
      virtualStoreDir,
    }),
    hoistedDependencies,
    hoistedModulesDir,
    hoistPattern: opts.hoistPattern,
    importerId,
    include: opts.include ?? include,
    lockfileDir: opts.lockfileDir,
    manifest: (await opts.readPackageHook?.(manifest)) ?? manifest,
    modulesDir,
    modulesFile: modules,
    pendingBuilds,
    prefix: opts.dir,
    publicHoistPattern: opts.publicHoistPattern,
    registries: {
      ...opts.registries,
      ...registries,
    },
    rootModulesDir,
    skipped,
    storeDir,
    virtualStoreDir,
    ...(await readLockfiles({
      autoInstallPeers: opts.autoInstallPeers,
      excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
      peersSuffixMaxLength: opts.peersSuffixMaxLength,
      force: opts.force,
      frozenLockfile: false,
      lockfileDir: opts.lockfileDir,
      projects: [{ id: importerId, rootDir: opts.dir as ProjectRootDir }],
      registry: opts.registries.default,
      useLockfile: opts.useLockfile,
      useGitBranchLockfile: opts.useGitBranchLockfile,
      mergeGitBranchLockfiles: opts.mergeGitBranchLockfiles,
      virtualStoreDir,
    })),
  };

  packageManifestLogger.debug({
    initial: manifest,
    prefix: opts.dir,
  });

  contextLogger.debug({
    currentLockfileExists: ctx.existsCurrentLockfile,
    storeDir: opts.storeDir,
    virtualStoreDir,
  });

  return ctx;
}

function getExtraNodePaths({
  extendNodePath = true,
  hoistPattern,
  nodeLinker,
  virtualStoreDir,
}: {
  extendNodePath?: boolean | undefined;
  hoistPattern?: string[] | undefined;
  nodeLinker?: 'isolated' | 'hoisted' | 'pnp' | undefined;
  virtualStoreDir: string;
}): string[] {
  if (
    extendNodePath &&
    nodeLinker === 'isolated' &&
    typeof hoistPattern?.length === 'number' &&
    hoistPattern.length > 0
  ) {
    return [path.join(virtualStoreDir, 'node_modules')];
  }

  return [];
}

export function arrayOfWorkspacePackagesToMap(
  pkgs: Array<Pick<ProjectOptions, 'manifest' | 'rootDir'>>
): WorkspacePackages {
  const workspacePkgs: WorkspacePackages = new Map();

  for (const { manifest, rootDir } of pkgs) {
    if (
      typeof manifest === 'undefined' ||
      typeof manifest.name === 'undefined'
    ) {
      continue;
    }

    let workspacePkgsByVersion = workspacePkgs.get(manifest.name);

    if (!workspacePkgsByVersion) {
      workspacePkgsByVersion = new Map();

      workspacePkgs.set(manifest.name, workspacePkgsByVersion);
    }

    workspacePkgsByVersion.set(manifest.version, {
      manifest,
      rootDir,
    });
  }

  return workspacePkgs;
}
