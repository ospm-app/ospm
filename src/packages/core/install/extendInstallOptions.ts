import { WANTED_LOCKFILE } from '../../constants/index.ts';
import type { Catalogs } from '../../catalogs.types/index.ts';
import { PnpmError } from '../../error/index.ts';
import type { HookOptions, ProjectOptions } from '../../get-context/index.ts';
import type { HoistingLimits } from '../../headless/index.ts';
import { createReadPackageHook } from '../../hooks.read-package-hook/index.ts';
import type { IncludedDependencies } from '../../modules-yaml/index.ts';
import {
  normalizeRegistries,
  DEFAULT_REGISTRIES,
} from '../../normalize-registries/index.ts';
import type { WorkspacePackages } from '../../resolver-base/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../../store-controller-types/index.ts';
import type {
  SupportedArchitectures,
  AllowedDeprecatedVersions,
  PackageExtension,
  ReadPackageHook,
  Registries,
  PrepareExecutionEnv,
  ModulesDir,
  LockFileDir,
  GlobalPkgDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../../types/index.ts';
import {
  parseOverrides,
  type PackageSelector,
} from '../../parse-overrides/index.ts';
import { pnpmPkgJson } from '../pnpmPkgJson.ts';
import type { ReporterFunction } from '../types.ts';
import type { PreResolutionHookContext } from '../../hooks.types/index.ts';
import type { LockfileObject } from '../../lockfile.types/index.ts';

export type StrictInstallOptions = {
  autoInstallPeers: boolean;
  autoInstallPeersFromHighestMatch: boolean;
  catalogs: Catalogs;
  frozenLockfile: boolean;
  frozenLockfileIfExists: boolean;
  enablePnp: boolean;
  extraBinPaths: string[];
  extraEnv: Record<string, string>;
  hoistingLimits: HoistingLimits;
  externalDependencies?: Set<string> | undefined;
  useLockfile: boolean;
  saveLockfile: boolean;
  useGitBranchLockfile: boolean;
  mergeGitBranchLockfiles: boolean;
  linkWorkspacePackagesDepth: number;
  lockfileOnly: boolean;
  forceFullResolution: boolean;
  fixLockfile: boolean;
  dedupe: boolean;
  ignoreCompatibilityDb: boolean;
  ignoreDepScripts: boolean;
  ignorePackageManifest: boolean;
  preferFrozenLockfile: boolean;
  saveWorkspaceProtocol: boolean | 'rolling';
  lockfileCheck?:
    | ((prev: LockfileObject, next: LockfileObject) => void)
    | undefined;
  lockfileIncludeTarballUrl: boolean;
  preferWorkspacePackages: boolean;
  preserveWorkspaceProtocol: boolean;
  scriptsPrependNodePath: boolean | 'warn-only';
  scriptShell?: string | undefined;
  shellEmulator: boolean;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  storeDir: string;
  reporter: ReporterFunction;
  force: boolean;
  forcePublicHoistPattern: boolean;
  depth: number;
  lockfileDir: LockFileDir;
  modulesDir: ModulesDir;
  rawConfig: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  verifyStoreIntegrity?: boolean | undefined;
  engineStrict: boolean;
  ignoredBuiltDependencies?: string[] | undefined;
  neverBuiltDependencies?: string[] | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  onlyBuiltDependenciesFile?: string | undefined;
  nodeExecPath?: string | undefined;
  nodeLinker: 'isolated' | 'hoisted' | 'pnp';
  nodeVersion?: string | undefined;
  packageExtensions: Record<string, PackageExtension>;
  ignoredOptionalDependencies: string[];
  pnpmfile: string;
  ignorePnpmfile: boolean;
  packageManager: {
    name: string;
    version: string;
  };
  pruneLockfileImporters: boolean;
  hooks: {
    readPackage?: ReadPackageHook[] | undefined;
    preResolution?:
      | ((ctx: PreResolutionHookContext) => Promise<void>)
      | undefined;
    afterAllResolved?:
      | Array<
          (lockfile: LockfileObject) => LockfileObject | Promise<LockfileObject>
        >
      | undefined;
    calculatePnpmfileChecksum?: (() => Promise<string | undefined>) | undefined;
  };
  sideEffectsCacheRead: boolean;
  sideEffectsCacheWrite: boolean;
  strictPeerDependencies: boolean;
  include: IncludedDependencies;
  includeDirect: IncludedDependencies;
  ignoreCurrentPrefs: boolean;
  ignoreScripts: boolean;
  childConcurrency: number;
  userAgent: string;
  unsafePerm: boolean;
  registries: Registries;
  tag: string;
  overrides: Record<string, string>;
  ownLifecycleHooksStdio: 'inherit' | 'pipe';
  // We can automatically calculate these
  // unless installation runs on a workspace
  // that doesn't share a lockfile
  workspacePackages?: WorkspacePackages | undefined;
  pruneStore: boolean;
  virtualStoreDir?: string | undefined;
  dir:
    | WorkspaceDir
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | LockFileDir;
  symlink: boolean;
  enableModulesDir: boolean;
  modulesCacheMaxAge: number;
  allowedDeprecatedVersions: AllowedDeprecatedVersions;
  allowNonAppliedPatches: boolean;
  preferSymlinkedExecutables: boolean;
  resolutionMode: 'highest' | 'time-based' | 'lowest-direct';
  resolvePeersFromWorkspaceRoot: boolean;
  ignoreWorkspaceCycles: boolean;
  disallowWorkspaceCycles: boolean;

  publicHoistPattern: string[] | undefined;
  hoistPattern: string[] | undefined;
  forceHoistPattern: boolean;

  shamefullyHoist: boolean;
  forceShamefullyHoist: boolean;

  global: boolean;
  globalBin?: string | undefined;
  patchedDependencies?: Record<string, string> | undefined;

  allProjects: (ProjectOptions & HookOptions & { binsDir: string })[];
  resolveSymlinksInInjectedDirs: boolean;
  dedupeDirectDeps: boolean;
  dedupeInjectedDeps: boolean;
  dedupePeerDependents: boolean;
  extendNodePath: boolean;
  excludeLinksFromLockfile: boolean;
  confirmModulesPurge: boolean;
  /**
   * Don't relink local directory dependencies if they are not hard linked from the local directory.
   *
   * This option was added to fix an issue with Bit CLI.
   * Bit compile adds dist directories to the injected dependencies, so if pnpm were to relink them,
   * the dist directories would be deleted.
   *
   * The option might be used in the future to improve performance.
   */
  disableRelinkLocalDirDeps: boolean;

  supportedArchitectures?: SupportedArchitectures | undefined;
  hoistWorkspacePackages?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  peersSuffixMaxLength: number;
  prepareExecutionEnv?: PrepareExecutionEnv | undefined;
  returnListOfDepsRequiringBuild?: boolean | undefined;
  injectWorkspacePackages?: boolean | undefined;
};

export type InstallOptions = Partial<
  Omit<StrictInstallOptions, 'storeDir' | 'storeController' | 'lockfileDir'>
> &
  Pick<StrictInstallOptions, 'storeDir' | 'storeController' | 'lockfileDir'>;

function defaults(opts: InstallOptions): StrictInstallOptions {
  const packageManager = opts.packageManager ?? {
    name: pnpmPkgJson.name,
    version: pnpmPkgJson.version,
  };

  return {
    forceShamefullyHoist: false,
    global: false,
    allProjects: [],
    disableRelinkLocalDirDeps: false,
    ignorePnpmfile: false,
    dir: '' as LockFileDir,
    preferSymlinkedExecutables: false,
    forceHoistPattern: false,
    reporter: () => {},
    forcePublicHoistPattern: false,
    modulesDir: 'node_modules' as ModulesDir,
    pnpmfile: '',
    hoistingLimits: new Map(),
    linkWorkspacePackagesDepth: 0,
    fixLockfile: false,
    dedupe: false,
    catalogs: {},
    frozenLockfileIfExists: false,
    extraBinPaths: [],
    extraEnv: {},
    allowedDeprecatedVersions: {},
    allowNonAppliedPatches: false,
    autoInstallPeers: true,
    autoInstallPeersFromHighestMatch: false,
    childConcurrency: 5,
    confirmModulesPurge: opts.force !== true,
    depth: 0,
    dedupeInjectedDeps: true,
    enablePnp: false,
    engineStrict: false,
    force: false,
    forceFullResolution: false,
    frozenLockfile: false,
    hoistPattern: undefined,
    publicHoistPattern: undefined,
    hooks: {},
    ignoreCurrentPrefs: false,
    ignoreDepScripts: false,
    ignoreScripts: false,
    include: {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    includeDirect: {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    lockfileDir:
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      opts.lockfileDir ??
      (opts.dir as LockFileDir | undefined) ??
      (process.cwd() as LockFileDir),
    lockfileOnly: false,
    nodeVersion: opts.nodeVersion,
    nodeLinker: 'isolated',
    overrides: {},
    ownLifecycleHooksStdio: 'inherit',
    ignoreCompatibilityDb: false,
    ignorePackageManifest: false,
    packageExtensions: {},
    ignoredOptionalDependencies: [] as string[],
    packageManager,
    preferFrozenLockfile: true,
    preferWorkspacePackages: false,
    preserveWorkspaceProtocol: true,
    pruneLockfileImporters: false,
    pruneStore: false,
    rawConfig: {},
    registries: DEFAULT_REGISTRIES,
    resolutionMode: 'lowest-direct',
    saveWorkspaceProtocol: 'rolling',
    lockfileIncludeTarballUrl: false,
    scriptsPrependNodePath: false,
    shamefullyHoist: false,
    shellEmulator: false,
    sideEffectsCacheRead: false,
    sideEffectsCacheWrite: false,
    symlink: true,
    storeController: opts.storeController,
    storeDir: opts.storeDir,
    strictPeerDependencies: false,
    tag: 'latest',
    unsafePerm:
      process.platform === 'win32' ||
      process.platform === 'cygwin' ||
      !process.setgid ||
      process.getuid?.() !== 0,
    useLockfile: true,
    saveLockfile: true,
    useGitBranchLockfile: false,
    mergeGitBranchLockfiles: false,
    userAgent: `${packageManager.name}/${packageManager.version} npm/? node/${process.version} ${process.platform} ${process.arch}`,
    verifyStoreIntegrity: true,
    enableModulesDir: true,
    modulesCacheMaxAge: 7 * 24 * 60,
    resolveSymlinksInInjectedDirs: false,
    dedupeDirectDeps: true,
    dedupePeerDependents: true,
    resolvePeersFromWorkspaceRoot: true,
    extendNodePath: true,
    ignoreWorkspaceCycles: false,
    disallowWorkspaceCycles: false,
    excludeLinksFromLockfile: false,
    virtualStoreDirMaxLength: 120,
    peersSuffixMaxLength: 1000,
  };
}

export type ProcessedInstallOptions = StrictInstallOptions & {
  readPackageHook?: ReadPackageHook | undefined;
  parsedOverrides: Array<
    | {
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
  >;
};

export function extendOptions(opts: InstallOptions): ProcessedInstallOptions {
  if (typeof opts !== 'undefined') {
    for (const key in opts) {
      if (opts[key as keyof InstallOptions] === undefined) {
        delete opts[key as keyof InstallOptions];
      }
    }
  }

  if (
    opts.neverBuiltDependencies == null &&
    opts.onlyBuiltDependencies == null &&
    opts.onlyBuiltDependenciesFile == null
  ) {
    opts.onlyBuiltDependencies = [];
  }

  if (opts.onlyBuiltDependencies && opts.neverBuiltDependencies) {
    throw new PnpmError(
      'CONFIG_CONFLICT_BUILT_DEPENDENCIES',
      'Cannot have both neverBuiltDependencies and onlyBuiltDependencies'
    );
  }

  const defaultOpts = defaults(opts);

  const extendedOpts: ProcessedInstallOptions = {
    ...defaultOpts,
    ...opts,
    storeDir: defaultOpts.storeDir,
    parsedOverrides: parseOverrides(opts.overrides ?? {}, opts.catalogs ?? {}),
  };

  extendedOpts.readPackageHook = createReadPackageHook({
    ignoreCompatibilityDb: extendedOpts.ignoreCompatibilityDb,
    readPackageHook: extendedOpts.hooks.readPackage,
    overrides: extendedOpts.parsedOverrides,
    lockfileDir: extendedOpts.lockfileDir,
    packageExtensions: extendedOpts.packageExtensions,
    ignoredOptionalDependencies: extendedOpts.ignoredOptionalDependencies,
  });

  if (extendedOpts.lockfileOnly) {
    extendedOpts.ignoreScripts = true;

    if (!extendedOpts.useLockfile) {
      throw new PnpmError(
        'CONFIG_CONFLICT_LOCKFILE_ONLY_WITH_NO_LOCKFILE',
        `Cannot generate a ${WANTED_LOCKFILE} because lockfile is set to false`
      );
    }
  }

  if (extendedOpts.userAgent.startsWith('npm/')) {
    extendedOpts.userAgent = `${extendedOpts.packageManager.name}/${extendedOpts.packageManager.version} ${extendedOpts.userAgent}`;
  }

  extendedOpts.registries = normalizeRegistries(extendedOpts.registries);

  extendedOpts.rawConfig['registry'] = extendedOpts.registries.default;

  return extendedOpts;
}
