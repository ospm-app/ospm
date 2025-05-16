import { OspmError } from '../error/index.ts';
import type { FetchFunction, FetchOptions } from '../fetcher-base/index.ts';
import type { Cafs, PackageFiles } from '../cafs-types/index.ts';
import type {
  FetchFromRegistry,
  GetAuthHeader,
  RetryTimeoutOptions,
} from '../fetching-types/index.ts';
import { TarballIntegrityError, type AddFilesResult } from '../worker/index.ts';
import {
  createDownloader,
  type DownloadFunction,
} from './remoteTarballFetcher.ts';
import { createLocalTarballFetcher } from './localTarballFetcher.ts';
import { createGitHostedTarballFetcher } from './gitHostedTarballFetcher.ts';
import type { DependencyManifest } from '../types/package.ts';
import type { Resolution } from '../resolver-base/index.ts';
import { createOspmTarballFetcher } from './ospmTarballFetcher.ts';

export { BadTarballError } from './errorTypes/index.ts';

export { TarballIntegrityError };

export type TarballFetchers = {
  localTarball: FetchFunction<Resolution, FetchOptions, AddFilesResult>;
  remoteTarball: FetchFunction<Resolution, FetchOptions, AddFilesResult>;
  gitHostedTarball: FetchFunction<
    Resolution,
    FetchOptions,
    {
      filesIndex: PackageFiles | Record<string, string>;
      manifest: DependencyManifest | undefined;
      requiresBuild: boolean;
    }
  >;
  ospmTarball: FetchFunction<Resolution, FetchOptions, AddFilesResult>;
};

export function createTarballFetcher(
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: GetAuthHeader,
  opts: {
    rawConfig: Record<string, string>;
    unsafePerm?: boolean | undefined;
    ignoreScripts?: boolean | undefined;
    timeout?: number | undefined;
    retry?: RetryTimeoutOptions | undefined;
    offline?: boolean | undefined;
  }
): TarballFetchers {
  const download = createDownloader(fetchFromRegistry, {
    retry: opts.retry,
    timeout: opts.timeout,
  });

  const remoteTarballFetcher = fetchFromTarball.bind(null, {
    download,
    getAuthHeaderByURI: getAuthHeader,
    offline: opts.offline ?? false,
  });

  return {
    localTarball: createLocalTarballFetcher(),
    remoteTarball: remoteTarballFetcher,
    gitHostedTarball: createGitHostedTarballFetcher(remoteTarballFetcher, opts),
    ospmTarball: createOspmTarballFetcher(fetchFromRegistry, getAuthHeader),
  };
}

async function fetchFromTarball(
  ctx: {
    download: DownloadFunction;
    getAuthHeaderByURI: (registry: string) => string | undefined;
    offline?: boolean | undefined;
  },
  cafs: Cafs,
  resolution: {
    integrity?: string | undefined;
    registry?: string | undefined;
    tarball?: string | undefined;
  },
  opts: FetchOptions
): Promise<AddFilesResult> {
  if (ctx.offline === true) {
    throw new OspmError(
      'NO_OFFLINE_TARBALL',
      `A package is missing from the store but cannot download it in offline mode. The missing package may be downloaded from ${resolution.tarball}.`
    );
  }

  if (typeof resolution.tarball !== 'string' || resolution.tarball === '') {
    throw new OspmError('NO_TARBALL', 'No tarball found');
  }

  return ctx.download(resolution.tarball, {
    getAuthHeaderByURI: ctx.getAuthHeaderByURI,
    cafs,
    integrity: resolution.integrity,
    readManifest: opts.readManifest,
    onProgress: opts.onProgress,
    onStart: opts.onStart,
    registry: resolution.registry,
    filesIndexFile: opts.filesIndexFile,
    pkg: opts.pkg,
  });
}
