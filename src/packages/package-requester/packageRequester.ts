import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getFilePathByModeInCafs as _getFilePathByModeInCafs,
  getIndexFilePathInCafs as _getIndexFilePathInCafs,
  type PackageFilesIndex,
} from '../store.cafs/index.ts';
import {
  fetchingProgressLogger,
  progressLogger,
} from '../core-loggers/index.ts';
import { pickFetcher } from '../pick-fetcher/index.ts';
import { PnpmError } from '../error/index.ts';
import type { FetchOptions, GitFetcherResult } from '../fetcher-base/index.ts';
import type {
  Cafs,
  PackageFileInfo,
  PackageFiles,
  PackageFilesResponse,
} from '../cafs-types/index.ts';
import gfs from '../graceful-fs/index.ts';
import { globalWarn, logger } from '../logger/index.ts';
import { packageIsInstallable } from '../package-is-installable/index.ts';
import { readPackageJson } from '../read-package-json/index.ts';
import type {
  Resolution,
  ResolveFunction,
  ResolveResult,
  TarballResolution,
  WorkspaceResolveResult,
} from '../resolver-base/index.ts';
import type {
  BundledManifest,
  FetchPackageToStoreFunction,
  FetchPackageToStoreOptions,
  GetFilesIndexFilePath,
  PackageResponse,
  PkgNameVersion,
  PkgRequestFetchResult,
  RequestPackageFunction,
  RequestPackageOptions,
} from '../store-controller-types/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import { depPathToFilename } from '../dependency-path/index.ts';
import { readPkgFromCafs as _readPkgFromCafs } from '../worker/index.ts';
import PQueue from 'p-queue';
import pDefer, { type DeferredPromise } from 'p-defer';
import pShare from 'promise-share';
import pick from 'ramda/src/pick';
import semver from 'semver';
import ssri from 'ssri';
import { equalOrSemverEqual } from './equalOrSemverEqual.ts';
import type { TarballFetchers } from '../tarball-fetcher/index.ts';
import type { WantedDependency } from '../resolve-dependencies/index.ts';

const TARBALL_INTEGRITY_FILENAME = 'tarball-integrity';
const packageRequestLogger = logger('package-requester');

const pickBundledManifest = pick.default([
  'bin',
  'bundledDependencies',
  'bundleDependencies',
  'dependencies',
  'directories',
  'engines',
  'name',
  'optionalDependencies',
  'os',
  'peerDependencies',
  'peerDependenciesMeta',
  'scripts',
  'version',
]);

function normalizeBundledManifest(
  manifest: DependencyManifest
): BundledManifest {
  return {
    ...pickBundledManifest(manifest),
    version:
      semver.clean(manifest.version || '0.0.0', { loose: true }) ??
      manifest.version,
  };
}

export function createPackageRequester(opts: {
  engineStrict?: boolean | undefined;
  force?: boolean | undefined;
  nodeVersion?: string | undefined;
  pnpmVersion?: string | undefined;
  resolve: ResolveFunction;
  fetchers: TarballFetchers;
  cafs: Cafs;
  ignoreFile?: ((filename: string) => boolean) | undefined;
  networkConcurrency?: number | undefined;
  storeDir: string;
  verifyStoreIntegrity?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  strictStorePkgContentCheck?: boolean | undefined;
}): ((
  wantedDependency: WantedDependency & {
    optional?: boolean | undefined;
  },
  options: RequestPackageOptions
) => Promise<
  | PackageResponse
  | {
      body: PackageResponse['body'];
    }
>) & {
  fetchPackageToStore: (
    opts: FetchPackageToStoreOptions
  ) => Promise<PackageResponse>;
  getFilesIndexFilePath: (
    opts: Pick<FetchPackageToStoreOptions, 'pkg' | 'ignoreScripts'>
  ) => {
    filesIndexFile: string;
    target: string;
  };
  requestPackage: (
    wantedDependency: WantedDependency & {
      optional?: boolean | undefined;
    },
    options: RequestPackageOptions
  ) => Promise<
    | PackageResponse
    | {
        body: PackageResponse['body'];
      }
  >;
} {
  // A lower bound of 16 is enforced to prevent performance degradation,
  // especially in CI environments. Tests with a threshold lower than 16
  // have shown consistent underperformance.
  const networkConcurrency =
    opts.networkConcurrency ??
    Math.max(os.availableParallelism() || os.cpus().length, 16);

  const requestsQueue = new PQueue({
    concurrency: networkConcurrency,
  });

  const getIndexFilePathInCafs = _getIndexFilePathInCafs.bind(
    null,
    opts.storeDir
  );

  const fetch = fetcher.bind<
    null,
    [fetcherByHostingType: TarballFetchers, cafs: Cafs],
    [packageId: string, resolution: Resolution, opts: FetchOptions],
    Promise<
      | {
          filesIndex: PackageFiles | Record<string, string>;
          manifest: DependencyManifest | undefined;
          requiresBuild: boolean;
          local?: boolean | undefined;
          packageImportMethod?: never | undefined;
        }
      | GitFetcherResult
    >
  >(null, opts.fetchers, opts.cafs);

  const fetchPackageToStore = _fetchPackageToStore.bind(null, {
    readPkgFromCafs: _readPkgFromCafs.bind<
      null,
      [string, boolean],
      [filesIndexFile: string, readManifest?: boolean | undefined],
      Promise<{
        verified: boolean;
        pkgFilesIndex: PackageFilesIndex;
        manifest?: DependencyManifest | undefined;
        requiresBuild: boolean;
      }>
    >(null, opts.storeDir, opts.verifyStoreIntegrity ?? false),
    fetch,
    fetchingLocker: new Map<string, FetchLock>(),
    getFilePathByModeInCafs: _getFilePathByModeInCafs.bind(null, opts.storeDir),
    getIndexFilePathInCafs,
    requestsQueue: Object.assign(requestsQueue, {
      counter: 0,
      concurrency: networkConcurrency,
    }),
    storeDir: opts.storeDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: opts.strictStorePkgContentCheck,
  });

  const requestPackage = resolveAndFetch.bind(null, {
    engineStrict: opts.engineStrict,
    nodeVersion: opts.nodeVersion,
    pnpmVersion: opts.pnpmVersion,
    force: opts.force,
    fetchPackageToStore,
    requestsQueue,
    resolve: opts.resolve,
    storeDir: opts.storeDir,
  });

  return Object.assign<
    (
      wantedDependency: WantedDependency & {
        optional?: boolean | undefined;
      },
      options: RequestPackageOptions
    ) => Promise<
      | PackageResponse
      | {
          body: PackageResponse['body'];
        }
    >,
    {
      fetchPackageToStore: (
        opts: FetchPackageToStoreOptions
      ) => Promise<PackageResponse>;
      getFilesIndexFilePath: (
        opts: Pick<FetchPackageToStoreOptions, 'pkg' | 'ignoreScripts'>
      ) => {
        filesIndexFile: string;
        target: string;
      };
      requestPackage: (
        wantedDependency: WantedDependency & {
          optional?: boolean | undefined;
        },
        options: RequestPackageOptions
      ) => Promise<
        | PackageResponse
        | {
            body: PackageResponse['body'];
          }
      >;
    }
  >(requestPackage, {
    fetchPackageToStore,
    getFilesIndexFilePath: getFilesIndexFilePath.bind(null, {
      getIndexFilePathInCafs,
      storeDir: opts.storeDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    }),
    requestPackage,
  });
}

export function createServerPackageRequester(opts: {
  engineStrict?: boolean | undefined;
  force?: boolean | undefined;
  nodeVersion?: string | undefined;
  pnpmVersion?: string | undefined;
  resolve: ResolveFunction;
  fetchers: TarballFetchers;
  cafs: Cafs;
  ignoreFile?: ((filename: string) => boolean) | undefined;
  networkConcurrency?: number | undefined;
  storeDir: string;
  verifyStoreIntegrity?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  strictStorePkgContentCheck?: boolean | undefined;
}): RequestPackageFunction<PackageResponse> & {
  fetchPackageToStore: FetchPackageToStoreFunction<PackageResponse>;
  getFilesIndexFilePath: GetFilesIndexFilePath;
  requestPackage: RequestPackageFunction<PackageResponse>;
} {
  // A lower bound of 16 is enforced to prevent performance degradation,
  // especially in CI environments. Tests with a threshold lower than 16
  // have shown consistent underperformance.
  const networkConcurrency =
    opts.networkConcurrency ??
    Math.max(os.availableParallelism() || os.cpus().length, 16);

  const requestsQueue = new PQueue({
    concurrency: networkConcurrency,
  });

  const getIndexFilePathInCafs = _getIndexFilePathInCafs.bind(
    null,
    opts.storeDir
  );

  const fetch = fetcher.bind<
    null,
    [fetcherByHostingType: TarballFetchers, cafs: Cafs],
    [packageId: string, resolution: Resolution, opts: FetchOptions],
    Promise<
      | {
          filesIndex: PackageFiles | Record<string, string>;
          manifest: DependencyManifest | undefined;
          requiresBuild: boolean;
          local?: boolean | undefined;
          packageImportMethod?: never | undefined;
        }
      | GitFetcherResult
    >
  >(null, opts.fetchers, opts.cafs);

  const fetchPackageToStore = _fetchPackageToStore.bind(null, {
    readPkgFromCafs: _readPkgFromCafs.bind<
      null,
      [string, boolean],
      [filesIndexFile: string, readManifest?: boolean | undefined],
      Promise<{
        verified: boolean;
        pkgFilesIndex: PackageFilesIndex;
        manifest?: DependencyManifest | undefined;
        requiresBuild: boolean;
      }>
    >(null, opts.storeDir, opts.verifyStoreIntegrity ?? false),
    fetch,
    fetchingLocker: new Map<string, FetchLock>(),
    getFilePathByModeInCafs: _getFilePathByModeInCafs.bind(null, opts.storeDir),
    getIndexFilePathInCafs,
    requestsQueue: Object.assign(requestsQueue, {
      counter: 0,
      concurrency: networkConcurrency,
    }),
    storeDir: opts.storeDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: opts.strictStorePkgContentCheck,
  });

  const requestPackage = resolveAndFetch.bind(null, {
    engineStrict: opts.engineStrict,
    nodeVersion: opts.nodeVersion,
    pnpmVersion: opts.pnpmVersion,
    force: opts.force,
    fetchPackageToStore,
    requestsQueue,
    resolve: opts.resolve,
    storeDir: opts.storeDir,
  });

  const obj = Object.assign(requestPackage, {
    fetchPackageToStore,
    getFilesIndexFilePath: getFilesIndexFilePath.bind(null, {
      getIndexFilePathInCafs,
      storeDir: opts.storeDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    }),
    requestPackage,
  });

  return obj;
}

export function createNewStorePackageRequester(opts: {
  engineStrict?: boolean | undefined;
  force?: boolean | undefined;
  nodeVersion?: string | undefined;
  pnpmVersion?: string | undefined;
  resolve: ResolveFunction;
  fetchers: TarballFetchers;
  cafs: Cafs;
  ignoreFile?: ((filename: string) => boolean) | undefined;
  networkConcurrency?: number | undefined;
  storeDir: string;
  verifyStoreIntegrity?: boolean | undefined;
  virtualStoreDirMaxLength: number;
  strictStorePkgContentCheck?: boolean | undefined;
}): RequestPackageFunction<PackageResponse> & {
  fetchPackageToStore: FetchPackageToStoreFunction<PackageResponse>;
  getFilesIndexFilePath: GetFilesIndexFilePath;
  requestPackage: RequestPackageFunction<PackageResponse>;
} {
  // A lower bound of 16 is enforced to prevent performance degradation,
  // especially in CI environments. Tests with a threshold lower than 16
  // have shown consistent underperformance.
  const networkConcurrency =
    opts.networkConcurrency ??
    Math.max(os.availableParallelism() || os.cpus().length, 16);

  const requestsQueue = new PQueue({
    concurrency: networkConcurrency,
  });

  const getIndexFilePathInCafs = _getIndexFilePathInCafs.bind(
    null,
    opts.storeDir
  );

  const fetch = fetcher.bind<
    null,
    [fetcherByHostingType: TarballFetchers, cafs: Cafs],
    [packageId: string, resolution: Resolution, opts: FetchOptions],
    Promise<
      | {
          filesIndex: PackageFiles | Record<string, string>;
          manifest: DependencyManifest | undefined;
          requiresBuild: boolean;
          local?: boolean | undefined;
          packageImportMethod?: never | undefined;
        }
      | GitFetcherResult
    >
  >(null, opts.fetchers, opts.cafs);

  const fetchPackageToStore = _fetchPackageToStore.bind(null, {
    readPkgFromCafs: _readPkgFromCafs.bind<
      null,
      [string, boolean],
      [filesIndexFile: string, readManifest?: boolean | undefined],
      Promise<{
        verified: boolean;
        pkgFilesIndex: PackageFilesIndex;
        manifest?: DependencyManifest | undefined;
        requiresBuild: boolean;
      }>
    >(null, opts.storeDir, opts.verifyStoreIntegrity ?? false),
    fetch,
    fetchingLocker: new Map<string, FetchLock>(),
    getFilePathByModeInCafs: _getFilePathByModeInCafs.bind(null, opts.storeDir),
    getIndexFilePathInCafs,
    requestsQueue: Object.assign(requestsQueue, {
      counter: 0,
      concurrency: networkConcurrency,
    }),
    storeDir: opts.storeDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: opts.strictStorePkgContentCheck,
  });

  const requestPackage = resolveAndFetch.bind(null, {
    engineStrict: opts.engineStrict,
    nodeVersion: opts.nodeVersion,
    pnpmVersion: opts.pnpmVersion,
    force: opts.force,
    fetchPackageToStore,
    requestsQueue,
    resolve: opts.resolve,
    storeDir: opts.storeDir,
  });

  return Object.assign(requestPackage, {
    fetchPackageToStore,
    getFilesIndexFilePath: getFilesIndexFilePath.bind(null, {
      getIndexFilePathInCafs,
      storeDir: opts.storeDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    }),
    requestPackage,
  });
}

async function resolveAndFetch(
  ctx: {
    engineStrict?: boolean | undefined;
    force?: boolean | undefined;
    nodeVersion?: string | undefined;
    pnpmVersion?: string | undefined;
    requestsQueue: {
      add: <T>(fn: () => Promise<T>, opts: { priority: number }) => Promise<T>;
    };
    resolve: ResolveFunction;
    fetchPackageToStore: FetchPackageToStoreFunction<PackageResponse>;
    storeDir: string;
  },
  wantedDependency: WantedDependency & { optional?: boolean | undefined },
  options: RequestPackageOptions
): Promise<PackageResponse | { body: PackageResponse['body'] }> {
  let latest: string | undefined;

  let manifest: DependencyManifest | undefined;

  let normalizedPref: string | undefined;

  let resolution = options.currentPkg?.resolution;

  let pkgId = options.currentPkg?.id;

  const skipResolution =
    typeof resolution !== 'undefined' && typeof options.update === 'undefined';

  let forceFetch = false;
  let updated = false;
  let resolvedVia: string | undefined;
  let publishedAt: string | undefined;

  // When fetching is skipped, resolution cannot be skipped.
  // We need the package's manifest when doing `lockfile-only` installs.
  // When we don't fetch, the only way to get the package's manifest is via resolving it.
  //
  // The resolution step is never skipped for local dependencies.
  if (
    !skipResolution ||
    options.skipFetch === true ||
    Boolean(pkgId?.startsWith('file:')) ||
    wantedDependency.optional === true
  ) {
    const resolveResult = await ctx.requestsQueue.add<
      ResolveResult | WorkspaceResolveResult
    >(
      async (): Promise<ResolveResult | WorkspaceResolveResult> => {
        return ctx.resolve(wantedDependency, {
          alwaysTryWorkspacePackages: options.alwaysTryWorkspacePackages,
          defaultTag: options.defaultTag,
          publishedBy: options.publishedBy,
          pickLowestVersion: options.pickLowestVersion,
          lockfileDir: options.lockfileDir,
          preferredVersions: options.preferredVersions,
          preferWorkspacePackages: options.preferWorkspacePackages,
          projectDir: options.projectDir,
          registry: options.registry,
          workspacePackages: options.workspacePackages,
          updateToLatest: options.update === 'latest',
          injectWorkspacePackages: options.injectWorkspacePackages,
        });
      },
      { priority: options.downloadPriority }
    );

    manifest = resolveResult.manifest;
    latest = resolveResult.latest;
    resolvedVia = resolveResult.resolvedVia;
    publishedAt = resolveResult.publishedAt;

    // If the integrity of a local tarball dependency has changed,
    // the local tarball should be unpacked, so a fetch to the store should be forced
    forceFetch = Boolean(
      typeof options.currentPkg?.resolution !== 'undefined' &&
        pkgId?.startsWith('file:') === true &&
        (options.currentPkg.resolution as TarballResolution).integrity !==
          (resolveResult.resolution as TarballResolution).integrity
    );

    updated = pkgId !== resolveResult.id || !resolution || forceFetch;
    resolution = resolveResult.resolution;
    pkgId = resolveResult.id;
    normalizedPref = resolveResult.normalizedPref;
  }

  const id = pkgId;

  if (typeof id === 'undefined') {
    throw new Error('Package ID is undefined');
  }

  if (
    typeof resolution !== 'undefined' &&
    'type' in resolution &&
    resolution.type === 'directory' &&
    id.startsWith('file:') !== true
  ) {
    if (typeof manifest === 'undefined') {
      throw new Error(
        `Couldn't read package.json of local dependency ${typeof wantedDependency.alias === 'string' ? `${wantedDependency.alias}@` : ''}${wantedDependency.pref}`
      );
    }

    return {
      body: {
        id,
        isLocal: true,
        manifest,
        normalizedPref,
        resolution,
        resolvedVia,
        updated,
      },
    };
  }

  const isInstallable =
    ctx.force === true ||
    (manifest == null
      ? undefined
      : await packageIsInstallable(id, manifest, {
          engineStrict: ctx.engineStrict,
          lockfileDir: options.lockfileDir,
          nodeVersion: ctx.nodeVersion,
          optional: wantedDependency.optional === true,
          supportedArchitectures: options.supportedArchitectures,
        }));

  if (typeof resolution === 'undefined') {
    throw new Error('Resolution is undefined');
  }

  // We can skip fetching the package only if the manifest
  // is present after resolution
  if (
    (options.skipFetch === true || isInstallable === false) &&
    manifest != null
  ) {
    return {
      body: {
        id,
        isLocal: false as const,
        isInstallable,
        latest,
        manifest,
        normalizedPref,
        resolution,
        resolvedVia,
        updated,
        publishedAt,
      },
    };
  }

  const pkg: PkgNameVersion =
    manifest != null ? pick.default(['name', 'version'], manifest) : {};

  const fetchResult = await ctx.fetchPackageToStore({
    fetchRawManifest: true,
    force: forceFetch,
    ignoreScripts: options.ignoreScripts,
    lockfileDir: options.lockfileDir,
    pkg: {
      ...pkg,
      id,
      resolution,
    },
    expectedPkg:
      options.expectedPkg?.name != null
        ? updated
          ? { name: options.expectedPkg.name, version: pkg.version }
          : options.expectedPkg
        : pkg,
    onFetchError: options.onFetchError,
  });

  if (
    typeof manifest === 'undefined' &&
    typeof fetchResult.fetching === 'function'
  ) {
    manifest = (await fetchResult.fetching()).bundledManifest;
  }

  return {
    body: {
      id,
      isLocal: false as const,
      isInstallable: isInstallable ?? undefined,
      latest,
      manifest,
      normalizedPref,
      resolution,
      resolvedVia,
      updated,
      publishedAt,
    },
    fetching: fetchResult.fetching,
    filesIndexFile: fetchResult.filesIndexFile,
  };
}

type FetchLock = {
  fetching?: Promise<PkgRequestFetchResult<PackageResponse>> | undefined;
  filesIndexFile: string;
  fetchRawManifest?: boolean | undefined;
};

function getFilesIndexFilePath(
  ctx: {
    getIndexFilePathInCafs: (integrity: string, pkgId: string) => string;
    storeDir: string;
    virtualStoreDirMaxLength: number;
  },
  opts: Pick<FetchPackageToStoreOptions, 'pkg' | 'ignoreScripts'>
): { filesIndexFile: string; target: string } {
  const targetRelative = depPathToFilename(
    opts.pkg.id,
    ctx.virtualStoreDirMaxLength
  );

  const target = path.join(ctx.storeDir, targetRelative);

  const integrity = (opts.pkg.resolution as TarballResolution).integrity;

  const filesIndexFile =
    typeof integrity === 'undefined'
      ? path.join(
          target,
          opts.ignoreScripts === true
            ? 'integrity-not-built.json'
            : 'integrity.json'
        )
      : ctx.getIndexFilePathInCafs(integrity, opts.pkg.id);

  return { filesIndexFile, target };
}

// async function fetchToStore(
//   ctx: {
//     readPkgFromCafs: (
//       filesIndexFile: string,
//       readManifest?: boolean | undefined
//     ) => Promise<{
//       verified: boolean;
//       pkgFilesIndex: PackageFilesIndex;
//       manifest?: DependencyManifest | undefined;
//       requiresBuild: boolean;
//     }>;
//     fetch: (
//       packageId: string,
//       resolution: Resolution,
//       opts: FetchOptions
//     ) => Promise<FetchResult>;
//     fetchingLocker: Map<
//       string,
//       FetchLock
//     >;
//     getIndexFilePathInCafs: (integrity: string, pkgId: string) => string;
//     getFilePathByModeInCafs: (integrity: string, mode: number) => string;
//     requestsQueue: {
//       add: <T>(fn: () => Promise<T>, opts: { priority: number }) => Promise<T>;
//       counter: number;
//       concurrency: number;
//     };
//     storeDir: string;
//     virtualStoreDirMaxLength: number;
//     strictStorePkgContentCheck?: boolean | undefined;
//   },
//   opts: FetchPackageToStoreOptions
// ): Promise<PackageResponse> {
//   if (typeof opts.pkg.name === 'undefined') {
//     opts.fetchRawManifest = true;
//   }

//   if (!ctx.fetchingLocker.has(opts.pkg.id)) {
//     const fetching = pDefer<{
//       files: {
//         unprocessed: boolean;
//         resolvedFrom: 'local-dir' | 'remote' | 'store';
//         filesIndex: PackageFiles;
//         packageImportMethod: 'hardlink';
//         requiresBuild: boolean;
//         sideEffects?: SideEffects | undefined;
//       };
//       bundledManifest: BundledManifest | undefined;
//     }>();

//     const { filesIndexFile, target } = getFilesIndexFilePath(ctx, opts);

//     doFetchToStore(filesIndexFile, fetching, target);

//     ctx.fetchingLocker.set(opts.pkg.id, {
//       fetching: removeKeyOnFail(fetching.promise),
//       filesIndexFile,
//       fetchRawManifest: opts.fetchRawManifest,
//     });

//     // When files resolves, the cached result has to set fromStore to true, without
//     // affecting previous invocations: so we need to replace the cache.
//     //
//     // Changing the value of fromStore is needed for correct reporting of `pnpm server`.
//     // Otherwise, if a package was not in store when the server started, it will always be
//     // reported as "downloaded" instead of "reused".
//     fetching.promise
//       .then((cache) => {
//         progressLogger.debug({
//           packageId: opts.pkg.id,
//           requester: opts.lockfileDir,
//           status:
//             cache.files.resolvedFrom === 'remote'
//               ? 'fetched'
//               : 'found_in_store',
//         });

//         // If it's already in the store, we don't need to update the cache
//         if (cache.files.resolvedFrom !== 'remote') {
//           return;
//         }

//         const tmp = ctx.fetchingLocker.get(opts.pkg.id);

//         // If fetching failed then it was removed from the cache.
//         // It is OK. In that case there is no need to update it.
//         if (tmp == null) return;

//         ctx.fetchingLocker.set(opts.pkg.id, {
//           ...tmp,
//           fetching: Promise.resolve({
//             ...cache,
//             files: {
//               ...cache.files,
//               resolvedFrom: 'store',
//             },
//           }),
//         });
//       })
//       .catch(() => {
//         ctx.fetchingLocker.delete(opts.pkg.id);
//       });
//   }

//   const result = ctx.fetchingLocker.get(opts.pkg.id);

//   if (typeof result === 'undefined') {
//     throw new Error('Fetch lock not found');
//   }

//   if (opts.fetchRawManifest === true && result.fetchRawManifest !== true) {
//     result.fetching = removeKeyOnFail(
//       result.fetching.then(async ({ files }) => {
//         const file: PackageFileInfo | undefined =
//           files.filesIndex['package.json'];

//         if (typeof file === 'undefined') {
//           return {
//             files,
//             bundledManifest: undefined,
//           };
//         }

//         if (files.unprocessed === true) {
//           const { integrity, mode } = file;

//           const manifestPath = ctx.getFilePathByModeInCafs(integrity, mode);

//           return {
//             files,
//             bundledManifest: await readBundledManifest(manifestPath),
//           };
//         }

//         return {
//           files,
//           bundledManifest: undefined,
//         };
//       })
//     );

//     result.fetchRawManifest = true;
//   }

//   return {
//     fetching: pShare(result.fetching),
//     filesIndexFile: result.filesIndexFile,
//   };

//   async function removeKeyOnFail<T>(p: Promise<T>): Promise<T> {
//     try {
//       return await p;
//       // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     } catch (err: any) {
//       ctx.fetchingLocker.delete(opts.pkg.id);
//       if (opts.onFetchError) {
//         throw opts.onFetchError(err);
//       }
//       throw err;
//     }
//   }

//   async function doFetchToStore(
//     filesIndexFile: string,
//     fetching: DeferredPromise<{
//       files: {
//         unprocessed: boolean;
//         resolvedFrom: 'local-dir' | 'remote' | 'store';
//         filesIndex: PackageFiles;
//         packageImportMethod: 'hardlink';
//         requiresBuild: boolean;
//         sideEffects?: SideEffects | undefined;
//       };
//       bundledManifest: BundledManifest | undefined;
//     }>,
//     target: string
//   ): Promise<void> {
//     try {
//       const isLocalTarballDep = opts.pkg.id.startsWith('file:');

//       const resolution = opts.pkg.resolution;

//       if (typeof resolution === 'undefined') {
//         throw new Error('Resolution is undefined');
//       }

//       const isLocalPkg = resolution.type === 'directory';

//       if (
//         !opts.force &&
//         (!isLocalTarballDep ||
//           (await tarballIsUpToDate(resolution, target, opts.lockfileDir))) &&
//         !isLocalPkg
//       ) {
//         const { verified, pkgFilesIndex, manifest, requiresBuild } =
//           await ctx.readPkgFromCafs(filesIndexFile, opts.fetchRawManifest);
//         if (verified) {
//           if (
//             (pkgFilesIndex.name != null &&
//               opts.expectedPkg?.name != null &&
//               pkgFilesIndex.name.toLowerCase() !==
//                 opts.expectedPkg.name.toLowerCase()) ||
//             (pkgFilesIndex.version != null &&
//               opts.expectedPkg?.version != null &&
//               // We used to not normalize the package versions before writing them to the lockfile and store.
//               // So it may happen that the version will be in different formats.
//               // For instance, v1.0.0 and 1.0.0
//               // Hence, we need to use semver.eq() to compare them.
//               !equalOrSemverEqual(
//                 pkgFilesIndex.version,
//                 opts.expectedPkg.version
//               ))
//           ) {
//             const msg = `Package name mismatch found while reading ${JSON.stringify(opts.pkg.resolution)} from the store.`;
//             const hint = `This means that either the lockfile is broken or the package metadata (name and version) inside the package's package.json file doesn't match the metadata in the registry. \
// Expected package: ${opts.expectedPkg.name}@${opts.expectedPkg.version}. \
// Actual package in the store with the given integrity: ${pkgFilesIndex.name}@${pkgFilesIndex.version}.`;
//             if (ctx.strictStorePkgContentCheck ?? true) {
//               throw new PnpmError('UNEXPECTED_PKG_CONTENT_IN_STORE', msg, {
//                 hint: `${hint}\n\nIf you want to ignore this issue, set the strict-store-pkg-content-check to false.`,
//               });
//             }

//             globalWarn(`${msg} ${hint}`);
//           }

//           fetching.resolve({
//             files: {
//               packageImportMethod: 'hardlink',
//               unprocessed: true,
//               filesIndex: pkgFilesIndex.files,
//               resolvedFrom: 'store',
//               sideEffects: pkgFilesIndex.sideEffects,
//               requiresBuild,
//             },
//             bundledManifest:
//               manifest == null ? manifest : normalizeBundledManifest(manifest),
//           });

//           return;
//         }

//         // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
//         if (pkgFilesIndex.files != null) {
//           packageRequestLogger.warn({
//             message: `Refetching ${target} to store. It was either modified or had no integrity checksums`,
//             prefix: opts.lockfileDir,
//           });
//         }
//       }

//       // We fetch into targetStage directory first and then fs.rename() it to the
//       // target directory.

//       // Tarballs are requested first because they are bigger than metadata files.
//       // However, when one line is left available, allow it to be picked up by a metadata request.
//       // This is done in order to avoid situations when tarballs are downloaded in chunks
//       // As many tarballs should be downloaded simultaneously as possible.
//       const priority =
//         (++ctx.requestsQueue.counter % ctx.requestsQueue.concurrency === 0
//           ? -1
//           : 1) * 1000;

//       const fetchedPackage = await ctx.requestsQueue.add(
//         async () => {
//           return ctx.fetch(opts.pkg.id, resolution, {
//             filesIndexFile,
//             lockfileDir: opts.lockfileDir,
//             readManifest: opts.fetchRawManifest,
//             onProgress: (downloaded: number): void => {
//               fetchingProgressLogger.debug({
//                 downloaded,
//                 packageId: opts.pkg.id,
//                 status: 'in_progress',
//               });
//             },
//             onStart: (size, attempt) => {
//               fetchingProgressLogger.debug({
//                 attempt,
//                 packageId: opts.pkg.id,
//                 size,
//                 status: 'started',
//               });
//             },
//             pkg: {
//               name: opts.pkg.name,
//               version: opts.pkg.version,
//             },
//           });
//         },
//         { priority }
//       );

//       const integrity = (opts.pkg.resolution as TarballResolution).integrity;

//       if (isLocalTarballDep && typeof integrity === 'string') {
//         await fs.mkdir(target, { recursive: true });

//         await gfs.writeFile(
//           path.join(target, TARBALL_INTEGRITY_FILENAME),
//           integrity,
//           'utf8'
//         );
//       }

//       fetching.resolve({
//         files: {
//           unprocessed: false,
//           resolvedFrom: fetchedPackage.local === true ? 'local-dir' : 'remote',
//           filesIndex: fetchedPackage.filesIndex,
//           packageImportMethod: fetchedPackage.packageImportMethod,
//           requiresBuild: fetchedPackage.requiresBuild,
//         },
//         bundledManifest:
//           fetchedPackage.manifest == null
//             ? fetchedPackage.manifest
//             : normalizeBundledManifest(fetchedPackage.manifest),
//       });
//       // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     } catch (err: any) {
//       fetching.reject(err);
//     }
//   }
// }

// {
//   files: {
//     unprocessed: boolean;
//     resolvedFrom: 'local-dir' | 'remote' | 'store';
//     filesIndex: PackageFiles;
//     requiresBuild: boolean;
//     sideEffects?: SideEffects | undefined;
//     packageImportMethod?:
//       | 'auto'
//       | 'hardlink'
//       | 'copy'
//       | 'clone'
//       | 'clone-or-copy'
//       | undefined;
//   };
//   bundledManifest: BundledManifest | undefined;
// }

async function _fetchPackageToStore(
  ctx: {
    readPkgFromCafs: (
      filesIndexFile: string,
      readManifest?: boolean | undefined
    ) => Promise<{
      verified: boolean;
      pkgFilesIndex: PackageFilesIndex;
      manifest?: DependencyManifest | undefined;
      requiresBuild: boolean;
    }>;

    fetch: (
      packageId: string,
      resolution: Resolution,
      opts: FetchOptions
    ) => Promise<
      | GitFetcherResult
      | {
          filesIndex: PackageFiles | Record<string, string>;
          manifest: DependencyManifest | undefined;
          requiresBuild: boolean;
          local?: boolean | undefined;
          packageImportMethod?: never | undefined;
        }
    >;

    fetchingLocker: Map<string, FetchLock>;

    getIndexFilePathInCafs: (integrity: string, pkgId: string) => string;
    getFilePathByModeInCafs: (integrity: string, mode: number) => string;
    requestsQueue: {
      add: <T>(fn: () => Promise<T>, opts: { priority: number }) => Promise<T>;
      counter: number;
      concurrency: number;
    };
    storeDir: string;
    virtualStoreDirMaxLength: number;
    strictStorePkgContentCheck?: boolean | undefined;
  },
  opts: FetchPackageToStoreOptions
): Promise<PackageResponse> {
  if (typeof opts.pkg.name === 'undefined') {
    opts.fetchRawManifest = true;
  }

  if (!ctx.fetchingLocker.has(opts.pkg.id)) {
    const fetching = pDefer<PkgRequestFetchResult<PackageResponse>>();

    const { filesIndexFile, target } = getFilesIndexFilePath(ctx, opts);

    doFetchToStore(filesIndexFile, fetching, target);

    ctx.fetchingLocker.set(opts.pkg.id, {
      fetching: removeKeyOnFail(fetching.promise),
      filesIndexFile,
      fetchRawManifest: opts.fetchRawManifest,
    });

    // When files resolves, the cached result has to set fromStore to true, without
    // affecting previous invocations: so we need to replace the cache.
    //
    // Changing the value of fromStore is needed for correct reporting of `pnpm server`.
    // Otherwise, if a package was not in store when the server started, it will always be
    // reported as "downloaded" instead of "reused".
    fetching.promise
      .then((cache: PkgRequestFetchResult<PackageResponse>): void => {
        progressLogger.debug({
          packageId: opts.pkg.id,
          requester: opts.lockfileDir,
          status:
            cache.files.resolvedFrom === 'remote'
              ? 'fetched'
              : 'found_in_store',
        });

        // If it's already in the store, we don't need to update the cache
        if (cache.files.resolvedFrom !== 'remote') {
          return;
        }

        const tmp = ctx.fetchingLocker.get(opts.pkg.id);

        // If fetching failed then it was removed from the cache.
        // It is OK. In that case there is no need to update it.
        if (tmp == null) {
          return;
        }

        ctx.fetchingLocker.set(opts.pkg.id, {
          ...tmp,
          fetching: Promise.resolve({
            ...cache,
            files: {
              ...cache.files,
              resolvedFrom: 'store',
            },
          }),
        });
      })
      .catch((): void => {
        ctx.fetchingLocker.delete(opts.pkg.id);
      });
  }

  const result = ctx.fetchingLocker.get(opts.pkg.id);

  if (typeof result === 'undefined') {
    throw new Error('Fetch lock not found');
  }

  if (
    opts.fetchRawManifest === true &&
    result.fetchRawManifest !== true &&
    typeof result.fetching !== 'undefined'
  ) {
    result.fetching = removeKeyOnFail(
      result.fetching.then(
        async ({
          files,
        }): Promise<
          | {
              files: PackageFilesResponse;
              bundledManifest: undefined;
            }
          | {
              files: PackageFilesResponse;
              bundledManifest: BundledManifest;
            }
        > => {
          const file: string | PackageFileInfo | undefined =
            files.filesIndex['package.json'];

          if (typeof file === 'undefined') {
            return {
              files,
              bundledManifest: undefined,
            };
          }

          if (files.unprocessed === true && typeof file !== 'string') {
            const { integrity, mode } = file;

            const manifestPath = ctx.getFilePathByModeInCafs(integrity, mode);

            return {
              files,
              bundledManifest: await readBundledManifest(manifestPath),
            };
          }

          return {
            files,
            bundledManifest: undefined,
          };
        }
      )
    );

    result.fetchRawManifest = true;
  }

  return {
    fetching:
      typeof result.fetching === 'undefined'
        ? undefined
        : pShare(result.fetching),
    filesIndexFile: result.filesIndexFile,
  };

  async function removeKeyOnFail<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      ctx.fetchingLocker.delete(opts.pkg.id);
      if (opts.onFetchError) {
        throw opts.onFetchError(err);
      }
      throw err;
    }
  }

  async function doFetchToStore(
    filesIndexFile: string,
    fetching: DeferredPromise<PkgRequestFetchResult<PackageResponse>>,
    target: string
  ): Promise<void> {
    try {
      const isLocalTarballDep = opts.pkg.id.startsWith('file:');

      const resolution = opts.pkg.resolution;

      if (typeof resolution === 'undefined') {
        throw new Error('Resolution is undefined');
      }

      const isLocalPkg =
        'type' in resolution && resolution.type === 'directory';

      if (
        opts.force !== true &&
        (!isLocalTarballDep ||
          (await tarballIsUpToDate(resolution, target, opts.lockfileDir))) &&
        !isLocalPkg
      ) {
        const { verified, pkgFilesIndex, manifest, requiresBuild } =
          await ctx.readPkgFromCafs(filesIndexFile, opts.fetchRawManifest);

        if (verified) {
          if (
            (pkgFilesIndex.name != null &&
              opts.expectedPkg?.name != null &&
              pkgFilesIndex.name.toLowerCase() !==
                opts.expectedPkg.name.toLowerCase()) ||
            (pkgFilesIndex.version != null &&
              opts.expectedPkg?.version != null &&
              // We used to not normalize the package versions before writing them to the lockfile and store.
              // So it may happen that the version will be in different formats.
              // For instance, v1.0.0 and 1.0.0
              // Hence, we need to use semver.eq() to compare them.
              !equalOrSemverEqual(
                pkgFilesIndex.version,
                opts.expectedPkg.version
              ))
          ) {
            const msg = `Package name mismatch found while reading ${JSON.stringify(opts.pkg.resolution)} from the store.`;
            const hint = `This means that either the lockfile is broken or the package metadata (name and version) inside the package's package.json file doesn't match the metadata in the registry. \
Expected package: ${opts.expectedPkg.name}@${opts.expectedPkg.version}. \
Actual package in the store with the given integrity: ${pkgFilesIndex.name}@${pkgFilesIndex.version}.`;
            if (ctx.strictStorePkgContentCheck ?? true) {
              throw new PnpmError('UNEXPECTED_PKG_CONTENT_IN_STORE', msg, {
                hint: `${hint}\n\nIf you want to ignore this issue, set the strict-store-pkg-content-check to false.`,
              });
            }

            globalWarn(`${msg} ${hint}`);
          }

          fetching.resolve({
            files: {
              packageImportMethod: 'hardlink',
              unprocessed: true,
              filesIndex: pkgFilesIndex.files,
              resolvedFrom: 'store',
              sideEffects: pkgFilesIndex.sideEffects,
              requiresBuild,
            },
            bundledManifest:
              manifest == null ? manifest : normalizeBundledManifest(manifest),
          });

          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (pkgFilesIndex.files != null) {
          packageRequestLogger.warn({
            message: `Refetching ${target} to store. It was either modified or had no integrity checksums`,
            prefix: opts.lockfileDir,
          });
        }
      }

      // We fetch into targetStage directory first and then fs.rename() it to the
      // target directory.

      // Tarballs are requested first because they are bigger than metadata files.
      // However, when one line is left available, allow it to be picked up by a metadata request.
      // This is done in order to avoid situations when tarballs are downloaded in chunks
      // As many tarballs should be downloaded simultaneously as possible.
      const priority =
        (++ctx.requestsQueue.counter % ctx.requestsQueue.concurrency === 0
          ? -1
          : 1) * 1000;

      const fetchedPackage = await ctx.requestsQueue.add(
        async () => {
          return ctx.fetch(opts.pkg.id, resolution, {
            filesIndexFile,
            lockfileDir: opts.lockfileDir,
            readManifest: opts.fetchRawManifest,
            onProgress: (downloaded: number): void => {
              fetchingProgressLogger.debug({
                downloaded,
                packageId: opts.pkg.id,
                status: 'in_progress',
              });
            },
            onStart: (size: number | null, attempt: number): void => {
              fetchingProgressLogger.debug({
                attempt,
                packageId: opts.pkg.id,
                size,
                status: 'started',
              });
            },
            pkg: {
              name: opts.pkg.name,
              version: opts.pkg.version,
            },
          });
        },
        { priority }
      );

      const integrity = (opts.pkg.resolution as TarballResolution).integrity;

      if (isLocalTarballDep && typeof integrity === 'string') {
        await fs.mkdir(target, { recursive: true });

        await gfs.writeFile(
          path.join(target, TARBALL_INTEGRITY_FILENAME),
          integrity,
          'utf8'
        );
      }

      fetching.resolve({
        files: {
          unprocessed: false,
          resolvedFrom: fetchedPackage.local === true ? 'local-dir' : 'remote',
          filesIndex: fetchedPackage.filesIndex as PackageFiles,
          packageImportMethod: fetchedPackage.packageImportMethod,
          requiresBuild: fetchedPackage.requiresBuild,
        },
        bundledManifest:
          fetchedPackage.manifest == null
            ? fetchedPackage.manifest
            : normalizeBundledManifest(fetchedPackage.manifest),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      fetching.reject(err);
    }
  }
}

async function readBundledManifest(
  pkgJsonPath: string
): Promise<BundledManifest> {
  return pickBundledManifest(await readPackageJson(pkgJsonPath));
}

async function tarballIsUpToDate(
  resolution: Resolution,
  pkgInStoreLocation: string,
  lockfileDir: string
): Promise<boolean> {
  let currentIntegrity: string | undefined;

  try {
    currentIntegrity = await gfs.readFile(
      path.join(pkgInStoreLocation, TARBALL_INTEGRITY_FILENAME),
      'utf8'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    return false;
  }
  if (
    typeof resolution.integrity === 'string' &&
    currentIntegrity !== resolution.integrity
  ) {
    return false;
  }

  const tarball = path.join(lockfileDir, resolution.tarball?.slice(5) ?? '');

  const tarballStream = createReadStream(tarball);

  try {
    return Boolean(await ssri.checkStream(tarballStream, currentIntegrity));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    return false;
  }
}

async function fetcher(
  fetcherByHostingType: TarballFetchers,
  cafs: Cafs,
  packageId: string,
  resolution: Resolution,
  opts: FetchOptions
): Promise<
  | {
      filesIndex: PackageFiles | Record<string, string>;
      manifest: DependencyManifest | undefined;
      requiresBuild: boolean;
      local?: boolean | undefined;
      packageImportMethod?: never | undefined;
    }
  | GitFetcherResult
> {
  const fetch = pickFetcher(fetcherByHostingType, resolution);

  try {
    return await fetch(cafs, resolution as any, opts); // eslint-disable-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    packageRequestLogger.warn({
      message: `Fetching ${packageId} failed!`,
      prefix: opts.lockfileDir,
    });

    throw err;
  }
}
