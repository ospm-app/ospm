import type { Catalogs } from '../catalogs.types/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  ModulesDir,
  Project,
  ProjectManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  ProjectsGraph,
  Registries,
  SslConfig,
  WorkspaceDir,
} from '../types/index.ts';
import type { OptionsFromRootManifest } from './getOptionsFromRootManifest.ts';
import type { CookedHooks } from '../pnpmfile/requireHooks.ts';
import type { ReporterType } from 'src/reporter/index.ts';

export type UniversalOptions = Pick<
  Config,
  'color' | 'dir' | 'rawConfig' | 'rawLocalConfig'
>;

export type WantedPackageManager = {
  name: string;
  version?: string | undefined;
}

export type VerifyDepsBeforeRun =
  | 'install'
  | 'warn'
  | 'error'
  | 'prompt'
  | false;

export interface Config extends OptionsFromRootManifest {
  allProjects?: Project[] | undefined;
  selectedProjectsGraph?:
    | Record<
        ProjectRootDir,
        {
          dependencies: ProjectRootDir[];
          package: Project;
        }
      >
    | undefined;
  allProjectsGraph?: ProjectsGraph | undefined;

  allowNew: boolean;
  autoInstallPeers?: boolean | undefined;
  bail: boolean;
  color: 'always' | 'auto' | 'never';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cliOptions: Record<string, any>;
  useBetaCli: boolean;
  excludeLinksFromLockfile: boolean;
  extraBinPaths: string[];
  extraEnv: Record<string, string>;
  failIfNoMatch: boolean;
  filter?: string | string[] | undefined;
  filterProd?: string | string[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawLocalConfig: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawConfig: Record<string, string>;
  dryRun?: boolean | undefined; // This option might be not supported ever
  global?: boolean | undefined;
  dir:
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | ProjectRootDir
    | WorkspaceDir
    | LockFileDir;
  bin: string;
  verifyDepsBeforeRun?: VerifyDepsBeforeRun | undefined;
  ignoreDepScripts?: boolean | undefined;
  ignoreScripts?: boolean | undefined;
  ignoreCompatibilityDb?: boolean | undefined;
  includeWorkspaceRoot?: boolean | undefined;
  optimisticRepeatInstall?: boolean | undefined;
  save?: boolean | undefined;
  saveProd?: boolean | undefined;
  saveDev?: boolean | undefined;
  saveOptional?: boolean | undefined;
  savePeer?: boolean | undefined;
  saveWorkspaceProtocol?: boolean | 'rolling' | undefined;
  lockfileIncludeTarballUrl?: boolean | undefined;
  scriptShell?: string | undefined;
  stream?: boolean | undefined;
  ospmExecPath: string;
  ospmHomeDir: string;
  production?: boolean | undefined;
  fetchRetries?: number | undefined;
  fetchRetryFactor?: number | undefined;
  fetchRetryMintimeout?: number | undefined;
  fetchRetryMaxtimeout?: number | undefined;
  fetchTimeout?: number | undefined;
  saveExact?: boolean | undefined;
  savePrefix?: string | undefined;
  shellEmulator?: boolean | undefined;
  scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
  force?: boolean | undefined;
  depth?: number | undefined;
  engineStrict?: boolean | undefined;
  nodeVersion?: string | undefined;
  offline?: boolean | undefined;
  registry?: string | undefined;
  optional?: boolean | undefined;
  unsafePerm?: boolean | undefined;
  loglevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug' | undefined;
  frozenLockfile?: boolean | undefined;
  preferFrozenLockfile?: boolean | undefined;
  only?: 'prod' | 'production' | 'dev' | 'development' | undefined;
  packageManager: {
    name: string;
    version: string;
  };
  wantedPackageManager?: WantedPackageManager | undefined;
  preferOffline?: boolean | undefined;
  sideEffectsCache?: boolean | undefined; // for backward compatibility
  sideEffectsCacheReadonly?: boolean | undefined; // for backward compatibility
  sideEffectsCacheRead?: boolean | undefined;
  sideEffectsCacheWrite?: boolean | undefined;
  shamefullyHoist?: boolean | undefined;
  dev?: boolean | undefined;
  ignoreCurrentPrefs?: boolean | undefined;
  recursive?: boolean | undefined;
  enablePrePostScripts?: boolean | undefined;
  useNodeVersion?: string | undefined;
  useStderr?: boolean | undefined;
  nodeLinker?: 'hoisted' | 'isolated' | 'pnp' | undefined;
  preferSymlinkedExecutables?: boolean | undefined;
  resolutionMode?: 'highest' | 'time-based' | 'lowest-direct' | undefined;
  registrySupportsTimeField?: boolean | undefined;
  failedToLoadBuiltInConfig: boolean;
  resolvePeersFromWorkspaceRoot?: boolean | undefined;
  deployAllFiles?: boolean | undefined;
  forceLegacyDeploy?: boolean | undefined;
  reporterHidePrefix?: boolean | undefined;

  // proxy
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  localAddress?: string | undefined;
  noProxy?: string | boolean | undefined;

  // ssl
  cert?: string | string[] | undefined;
  key?: string | undefined;
  ca?: string | string[] | undefined;
  strictSsl?: boolean | undefined;

  userAgent?: string | undefined;
  tag?: string | undefined;
  updateNotifier?: boolean | undefined;

  // ospm specific configs
  cacheDir: string;
  configDir: string;
  stateDir: string;
  storeDir: string;
  virtualStoreDir?: string | undefined;
  verifyStoreIntegrity?: boolean | undefined;
  maxSockets?: number | undefined;
  networkConcurrency?: number | undefined;
  fetchingConcurrency?: number | undefined;
  lockfileOnly?: boolean | undefined; // like npm's --package-lock-only
  childConcurrency?: number | undefined;
  ignoreOspmfile?: boolean | undefined;
  ospmfile: string;
  hooks?: CookedHooks | undefined;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  hoistPattern?: string[] | undefined;
  publicHoistPattern?: string[] | string | undefined;
  hoistWorkspacePackages?: boolean | undefined;
  useStoreServer?: boolean | undefined;
  useRunningStoreServer?: boolean | undefined;
  workspaceConcurrency?: number | undefined;
  workspaceDir?: WorkspaceDir | undefined;
  workspacePackagePatterns?: string[] | undefined;
  catalogs?: Catalogs | undefined;
  reporter?: ReporterType | undefined;
  aggregateOutput: boolean;
  linkWorkspacePackages: boolean | 'deep';
  injectWorkspacePackages?: boolean | undefined;
  preferWorkspacePackages: boolean;
  reverse: boolean;
  sort: boolean;
  strictPeerDependencies: boolean;
  lockfileDir: LockFileDir;
  modulesDir?: ModulesDir | undefined;
  sharedWorkspaceLockfile?: boolean | undefined;
  useLockfile: boolean;
  useGitBranchLockfile: boolean;
  mergeGitBranchLockfiles?: boolean | undefined;
  mergeGitBranchLockfilesBranchPattern?: string[] | undefined;
  globalOspmfile?: string | undefined;
  npmPath?: string | undefined;
  gitChecks?: boolean | undefined;
  publishBranch?: string | undefined;
  recursiveInstall?: boolean | undefined;
  symlink: boolean;
  enablePnp?: boolean | undefined;
  enableModulesDir: boolean;
  modulesCacheMaxAge: number;
  dlxCacheMaxAge: number;
  embedReadme?: boolean | undefined;
  gitShallowHosts?: string[] | undefined;
  legacyDirFiltering?: boolean | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  dedupePeerDependents?: boolean | undefined;
  patchesDir?: string | undefined;
  ignoreWorkspaceCycles?: boolean | undefined;
  disallowWorkspaceCycles?: boolean | undefined;
  packGzipLevel?: number | undefined;

  registries: Registries;
  sslConfigs?: Record<string, SslConfig> | undefined;
  ignoreWorkspaceRootCheck: boolean;
  workspaceRoot?: boolean | undefined;

  testPattern?: string[] | undefined;
  changedFilesIgnorePattern?: string[] | undefined;
  rootProjectManifestDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;

  rootProjectManifest?: ProjectManifest | undefined;
  userConfig?: Record<string, string> | undefined;

  globalconfig: string;
  hoist: boolean;
  packageLock: boolean;
  pending: boolean;
  userconfig: string;
  workspacePrefix?: string | undefined;
  dedupeDirectDeps?: boolean | undefined;
  extendNodePath?: boolean | undefined;
  gitBranchLockfile?: boolean | undefined;
  globalDir?: string | undefined;
  globalPkgDir: GlobalPkgDir;
  lockfile?: boolean | undefined;
  dedupeInjectedDeps?: boolean | undefined;
  nodeOptions?: string | undefined;
  packageManagerStrict?: boolean | undefined;
  packageManagerStrictVersion?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  peersSuffixMaxLength?: number | undefined;
  strictStorePkgContentCheck?: boolean | undefined;
  managePackageManagerVersions: boolean;
  strictDepBuilds: boolean;
  syncInjectedDepsAfterScripts?: string[] | undefined;
  initPackageManager: boolean;
}

export interface ConfigWithDeprecatedSettings extends Config {
  globalPrefix?: string | undefined;
  proxy?: string | undefined;
  shamefullyFlatten?: boolean | undefined;
}
