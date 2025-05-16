import path from 'node:path';
import type { Config } from '../../config/index.ts';
import {
  normalizeRegistries,
  DEFAULT_REGISTRIES,
} from '../../normalize-registries/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../../store-controller-types/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  Registries,
  WorkspaceDir,
} from '../../types/index.ts';
import { loadJsonFile } from 'load-json-file';
import type { ReporterFunction } from '../../headless/index.ts';
import { getOptionsFromRootManifest } from '../../config/getOptionsFromRootManifest.ts';

export type StrictRebuildOptions<IP> = {
  autoInstallPeers?: boolean | undefined;
  cacheDir: string;
  childConcurrency: number;
  excludeLinksFromLockfile?: boolean | undefined;
  extraBinPaths?: string[] | undefined;
  extraEnv?: Record<string, string> | undefined;
  lockfileDir: LockFileDir;
  nodeLinker?: 'isolated' | 'hoisted' | 'pnp' | undefined;
  preferSymlinkedExecutables?: boolean;
  scriptShell?: string | undefined;
  sideEffectsCacheRead?: boolean | undefined;
  sideEffectsCacheWrite?: boolean | undefined;
  scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
  shellEmulator?: boolean | undefined;
  skipIfHasSideEffectsCache?: boolean | undefined;
  storeDir: string; // TODO: remove this property
  storeController?:
    | StoreController<PackageResponse, PackageResponse, IP>
    | undefined;
  force?: boolean | undefined;
  useLockfile: boolean;
  registries: Registries;
  dir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  ospmHomeDir: string;

  reporter?: ReporterFunction | undefined;
  production: boolean;
  development: boolean;
  optional: boolean;
  rawConfig: Record<string, string>;
  userConfig?: Record<string, string> | undefined;
  userAgent?: string | undefined;
  packageManager: {
    name: string;
    version: string;
  };
  unsafePerm?: boolean | undefined;
  pending?: boolean | undefined;
  shamefullyHoist: boolean;
  deployAllFiles?: boolean | undefined;
  neverBuiltDependencies?: string[] | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  virtualStoreDirMaxLength: number;
  peersSuffixMaxLength?: number | undefined;
  strictStorePkgContentCheck?: boolean | undefined;
  fetchFullMetadata?: boolean | undefined;
} & Pick<
  Config,
  | 'sslConfigs'
  | 'onlyBuiltDependencies'
  | 'onlyBuiltDependenciesFile'
  | 'neverBuiltDependencies'
>;

export type RebuildOptions<IP> = Partial<StrictRebuildOptions<IP>> &
  Pick<StrictRebuildOptions<IP>, 'cacheDir' | 'storeDir' | 'storeController'> &
  Pick<Config, 'rootProjectManifest' | 'rootProjectManifestDir'>;

const defaults = async <IP>(
  opts: RebuildOptions<IP>
): Promise<StrictRebuildOptions<IP>> => {
  const packageManager =
    opts.packageManager ??
    (await loadJsonFile<{ name: string; version: string }>(
      path.join(__dirname, '../../package.json')
    ));

  const dir = opts.dir ?? process.cwd();

  const lockfileDir = opts.lockfileDir ?? dir;

  return {
    cacheDir: opts.cacheDir,
    childConcurrency: 5,
    development: true,
    dir,
    force: false,
    lockfileDir,
    nodeLinker: 'isolated',
    optional: true,
    packageManager,
    pending: false,
    production: true,
    rawConfig: {},
    registries: DEFAULT_REGISTRIES,
    scriptsPrependNodePath: false,
    shamefullyHoist: false,
    shellEmulator: false,
    sideEffectsCacheRead: false,
    storeDir: opts.storeDir,
    unsafePerm:
      process.platform === 'win32' ||
      process.platform === 'cygwin' ||
      !process.setgid ||
      process.getuid?.() !== 0,
    useLockfile: true,
    userAgent: `${packageManager.name}/${packageManager.version} npm/? node/${process.version} ${process.platform} ${process.arch}`,
    // TODO: fix as
  } as StrictRebuildOptions<IP>;
};

export async function extendRebuildOptions<IP>(
  opts: RebuildOptions<IP>
): Promise<StrictRebuildOptions<IP>> {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition
  if (opts) {
    for (const key in opts) {
      if (opts[key as keyof RebuildOptions<IP>] === undefined) {
        delete opts[key as keyof RebuildOptions<IP>];
      }
    }
  }

  const defaultOpts = await defaults(opts);

  const extendedOpts = {
    ...defaultOpts,
    ...opts,
    storeDir: defaultOpts.storeDir,
    ...(opts.rootProjectManifest
      ? getOptionsFromRootManifest(
          opts.rootProjectManifestDir,
          opts.rootProjectManifest
        )
      : {}),
  };

  extendedOpts.registries = normalizeRegistries(extendedOpts.registries);

  if (
    extendedOpts.neverBuiltDependencies == null &&
    extendedOpts.onlyBuiltDependencies == null &&
    extendedOpts.onlyBuiltDependenciesFile == null
  ) {
    extendedOpts.onlyBuiltDependencies = [];
  }

  return extendedOpts;
}
