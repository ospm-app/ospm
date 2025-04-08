import { promises as fs } from 'node:fs';
import { createClient } from '../client/index.ts';

import type {
  CafsLocker,
  NewStoreController,
  PackageResponse,
} from '../package-store/index.ts';
import { packageManager } from '../cli-meta/index.ts';
import type { StoreServerController } from '../server/connectStoreController.ts';
import {
  createNewPackageStore,
  createServerPackageStore,
} from '../package-store/storeController/index.ts';
import type { CookedHooks } from '../pnpmfile/requireHooks.ts';
import type { SslConfig } from '../types/index.ts';

export type CreateNewStoreControllerOptions = {
  cacheDir: string;
  storeDir: string;
  rawConfig: Record<string, string>;

  fetchRetries?: number | undefined;
  fetchRetryFactor?: number | undefined;
  fetchRetryMaxtimeout?: number | undefined;
  fetchRetryMintimeout?: number | undefined;

  ca?: string | string[] | undefined;
  cert?: string | string[] | undefined;
  engineStrict?: boolean | undefined;
  force?: boolean | undefined;
  nodeVersion?: string | undefined;
  fetchTimeout?: number | undefined;
  gitShallowHosts?: string[] | undefined;
  ignoreScripts?: boolean | undefined;
  hooks?: CookedHooks | undefined;
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  key?: string | undefined;
  localAddress?: string | undefined;
  maxSockets?: number | undefined;
  networkConcurrency?: number | undefined;
  noProxy?: string | boolean | undefined;
  offline?: boolean | undefined;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  preferOffline?: boolean | undefined;
  registry?: string | undefined;
  registrySupportsTimeField?: boolean | undefined;
  resolutionMode?: 'highest' | 'time-based' | 'lowest-direct' | undefined;
  strictSsl?: boolean | undefined;
  unsafePerm?: boolean | undefined;
  userAgent?: string | undefined;
  verifyStoreIntegrity?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  cafsLocker?: CafsLocker | undefined;
  ignoreFile?: ((filename: string) => boolean) | undefined;
  fetchFullMetadata?: boolean | undefined;
  userConfig?: Record<string, string> | undefined;
  deployAllFiles?: boolean | undefined;
  sslConfigs?: Record<string, SslConfig> | undefined;
  strictStorePkgContentCheck?: boolean | undefined;
  resolveSymlinksInInjectedDirs?: boolean | undefined;
};

export async function createNewStoreController(
  opts: CreateNewStoreControllerOptions
): Promise<{
  ctrl: NewStoreController<
    PackageResponse,
    PackageResponse,
    { isBuilt: boolean; importMethod?: string | undefined }
  >;
  dir: string;
}> {
  const fullMetadata =
    opts.fetchFullMetadata ??
    (opts.resolutionMode === 'time-based' &&
      opts.registrySupportsTimeField !== true);

  const { resolve, fetchers, clearResolutionCache } = createClient({
    customFetchers: opts.hooks?.fetchers,
    userConfig: opts.userConfig,
    unsafePerm: opts.unsafePerm,
    authConfig: opts.rawConfig,
    ca: opts.ca,
    cacheDir: opts.cacheDir,
    cert: opts.cert,
    fullMetadata,
    filterMetadata: fullMetadata,
    httpProxy: opts.httpProxy,
    httpsProxy: opts.httpsProxy,
    ignoreScripts: opts.ignoreScripts,
    key: opts.key,
    localAddress: opts.localAddress,
    noProxy: opts.noProxy,
    offline: opts.offline,
    preferOffline: opts.preferOffline,
    rawConfig: opts.rawConfig,
    sslConfigs: opts.sslConfigs,
    retry: {
      factor: opts.fetchRetryFactor ?? 10,
      maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
      minTimeout: opts.fetchRetryMintimeout ?? 10_000,
      retries: opts.fetchRetries ?? 3,
    },
    strictSsl: opts.strictSsl ?? true,
    timeout: opts.fetchTimeout,
    userAgent: opts.userAgent,
    maxSockets:
      opts.maxSockets ??
      (opts.networkConcurrency != null
        ? opts.networkConcurrency * 3
        : undefined),
    gitShallowHosts: opts.gitShallowHosts,
    resolveSymlinksInInjectedDirs: opts.resolveSymlinksInInjectedDirs,
    includeOnlyPackageFiles: opts.deployAllFiles !== true,
  });

  await fs.mkdir(opts.storeDir, { recursive: true });

  return {
    ctrl: createNewPackageStore(resolve, fetchers, {
      cafsLocker: opts.cafsLocker,
      engineStrict: opts.engineStrict,
      force: opts.force,
      nodeVersion: opts.nodeVersion,
      pnpmVersion: packageManager.version,
      ignoreFile: opts.ignoreFile,
      importPackage: opts.hooks?.importPackage,
      networkConcurrency: opts.networkConcurrency,
      packageImportMethod: opts.packageImportMethod,
      cacheDir: opts.cacheDir,
      storeDir: opts.storeDir,
      verifyStoreIntegrity:
        typeof opts.verifyStoreIntegrity === 'boolean'
          ? opts.verifyStoreIntegrity
          : true,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      strictStorePkgContentCheck: opts.strictStorePkgContentCheck,
      clearResolutionCache,
    }),
    dir: opts.storeDir,
  };
}

export async function createNewServerStoreController(
  opts: CreateNewStoreControllerOptions
): Promise<{
  ctrl: StoreServerController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  dir: string;
}> {
  const fullMetadata =
    opts.fetchFullMetadata ??
    (opts.resolutionMode === 'time-based' &&
      opts.registrySupportsTimeField !== true);

  const { resolve, fetchers, clearResolutionCache } = createClient({
    customFetchers: opts.hooks?.fetchers,
    userConfig: opts.userConfig,
    unsafePerm: opts.unsafePerm,
    authConfig: opts.rawConfig,
    ca: opts.ca,
    cacheDir: opts.cacheDir,
    cert: opts.cert,
    fullMetadata,
    filterMetadata: fullMetadata,
    httpProxy: opts.httpProxy,
    httpsProxy: opts.httpsProxy,
    ignoreScripts: opts.ignoreScripts,
    key: opts.key,
    localAddress: opts.localAddress,
    noProxy: opts.noProxy,
    offline: opts.offline,
    preferOffline: opts.preferOffline,
    rawConfig: opts.rawConfig,
    sslConfigs: opts.sslConfigs,
    retry: {
      factor: opts.fetchRetryFactor ?? 10,
      maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
      minTimeout: opts.fetchRetryMintimeout ?? 10_000,
      retries: opts.fetchRetries ?? 3,
    },
    strictSsl: opts.strictSsl ?? true,
    timeout: opts.fetchTimeout,
    userAgent: opts.userAgent,
    maxSockets:
      opts.maxSockets ??
      (opts.networkConcurrency != null
        ? opts.networkConcurrency * 3
        : undefined),
    gitShallowHosts: opts.gitShallowHosts,
    resolveSymlinksInInjectedDirs: opts.resolveSymlinksInInjectedDirs,
    includeOnlyPackageFiles: opts.deployAllFiles !== true,
  });

  // if (typeof opts.storeDir === 'string') {
  // }
  await fs.mkdir(opts.storeDir, { recursive: true });

  return {
    ctrl: createServerPackageStore(resolve, fetchers, {
      cafsLocker: opts.cafsLocker,
      engineStrict: opts.engineStrict,
      force: opts.force,
      nodeVersion: opts.nodeVersion,
      pnpmVersion: packageManager.version,
      ignoreFile: opts.ignoreFile,
      importPackage: opts.hooks?.importPackage,
      networkConcurrency: opts.networkConcurrency,
      packageImportMethod: opts.packageImportMethod,
      cacheDir: opts.cacheDir,
      storeDir: opts.storeDir,
      verifyStoreIntegrity:
        typeof opts.verifyStoreIntegrity === 'boolean'
          ? opts.verifyStoreIntegrity
          : true,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      strictStorePkgContentCheck: opts.strictStorePkgContentCheck,
      clearResolutionCache,
    }),
    dir: opts.storeDir,
  };
}
