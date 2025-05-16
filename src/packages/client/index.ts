import {
  type ResolveFunction,
  createResolver as _createResolver,
} from '../default-resolver/index.ts';
import { createFetchFromRegistry } from '../fetch/index.ts';
import type { SslConfig } from '../types/index.ts';
import type {
  FetchFromRegistry,
  GetAuthHeader,
  RetryTimeoutOptions,
} from '../fetching-types/index.ts';
import type {
  CustomFetchers,
  GitFetcher,
  DirectoryFetcher,
} from '../fetcher-base/index.ts';
import { createDirectoryFetcher } from '../directory-fetcher/index.ts';
import { createGitFetcher } from '../git-fetcher/index.ts';
import {
  createTarballFetcher,
  type TarballFetchers,
} from '../tarball-fetcher/index.ts';
import { createGetAuthHeaderByURI } from '../network.auth-header/index.ts';
import mapValue from 'ramda/src/map';
import { createOspmTarballFetcher } from '../tarball-fetcher/ospmTarballFetcher.ts';

export type { ResolveFunction };

export type ClientOptions = {
  authConfig: Record<string, string>;
  customFetchers?: CustomFetchers | undefined;
  ignoreScripts?: boolean | undefined;
  rawConfig: Record<string, string>;
  sslConfigs?: Record<string, SslConfig> | undefined;
  retry?: RetryTimeoutOptions | undefined;
  timeout?: number | undefined;
  unsafePerm?: boolean | undefined;
  userAgent?: string | undefined;
  userConfig?: Record<string, string> | undefined;
  gitShallowHosts?: string[] | undefined;
  resolveSymlinksInInjectedDirs?: boolean | undefined;
  includeOnlyPackageFiles?: boolean | undefined;

  cacheDir: string;
  fullMetadata?: boolean | undefined;
  filterMetadata?: boolean | undefined;
  offline?: boolean | undefined;
  preferOffline?: boolean | undefined;

  ca?: string | string[] | undefined;
  cert?: string | string[] | undefined;
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  key?: string | undefined;
  localAddress?: string | undefined;
  maxSockets?: number | undefined;
  noProxy?: boolean | string | undefined;
  strictSsl?: boolean | undefined;
  clientCertificates?:
    | {
        [registryUrl: string]: {
          cert: string;
          key: string;
          ca?: string | undefined;
        };
      }
    | undefined;
};

export type Client = {
  fetchers: TarballFetchers;
  resolve: ResolveFunction;
  clearResolutionCache: () => void;
};

export function createClient(opts: ClientOptions): Client {
  const fetchFromRegistry = createFetchFromRegistry(opts);

  const getAuthHeader = createGetAuthHeaderByURI({
    allSettings: opts.authConfig,
    userSettings: opts.userConfig,
  });

  const { resolve, clearCache: clearResolutionCache } = _createResolver(
    fetchFromRegistry,
    getAuthHeader,
    opts
  );

  return {
    fetchers: createFetchers(
      fetchFromRegistry,
      getAuthHeader,
      opts,
      opts.customFetchers
    ),
    resolve,
    clearResolutionCache,
  };
}

export function createResolver(opts: ClientOptions): {
  resolve: ResolveFunction;
  clearCache: () => void;
} {
  const fetchFromRegistry = createFetchFromRegistry(opts);

  const getAuthHeader = createGetAuthHeaderByURI({
    allSettings: opts.authConfig,
    userSettings: opts.userConfig,
  });

  return _createResolver(fetchFromRegistry, getAuthHeader, opts);
}

type Fetchers = {
  git: GitFetcher;
  directory: DirectoryFetcher;
} & TarballFetchers;

function createFetchers(
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: GetAuthHeader,
  opts: Pick<
    ClientOptions,
    | 'rawConfig'
    | 'retry'
    | 'gitShallowHosts'
    | 'resolveSymlinksInInjectedDirs'
    | 'unsafePerm'
    | 'includeOnlyPackageFiles'
  >,
  customFetchers?: CustomFetchers | undefined
): Fetchers {
  const defaultFetchers: Fetchers = {
    ...createTarballFetcher(fetchFromRegistry, getAuthHeader, opts),
    ...createGitFetcher(opts),
    ...createDirectoryFetcher({
      resolveSymlinks: opts.resolveSymlinksInInjectedDirs,
      includeOnlyPackageFiles: opts.includeOnlyPackageFiles,
    }),
    ...createOspmTarballFetcher(fetchFromRegistry, getAuthHeader),
  };

  // TODO: fix
  const overwrites = mapValue.default(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (factory: any): any => {
      return factory({ defaultFetchers });
    },
    customFetchers ?? ({} as CustomFetchers)
  );

  return {
    ...defaultFetchers,
    ...overwrites,
  };
}
