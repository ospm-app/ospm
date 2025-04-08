import type {
  Resolution,
  GitResolution,
  DirectoryResolution,
  LocalTarballResolution,
  GitHostedTarballResolution,
} from '../resolver-base/index.ts';
import type { Cafs, PackageFiles } from '../cafs-types/index.ts';
import type { DependencyManifest } from '../types/index.ts';

export type PkgNameVersion = {
  name?: string | undefined;
  version?: string | undefined;
};

export type FetchOptions = {
  filesIndexFile: string;
  lockfileDir: string;
  onStart?: ((totalSize: number | null, attempt: number) => void) | undefined;
  onProgress?: ((downloaded: number) => void) | undefined;
  readManifest?: boolean | undefined;
  pkg: PkgNameVersion;
};

export type FetchFunction<
  FetcherResolution = Resolution,
  Options = FetchOptions,
  Result = FetchResult,
> = (
  cafs: Cafs,
  resolution: FetcherResolution,
  opts: Options
) => Promise<Result>;

export type FetchResult = {
  local?: boolean | undefined;
  manifest?: DependencyManifest | undefined;
  filesIndex: PackageFiles;
  requiresBuild: boolean;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
};

export type GitFetcherOptions = {
  readManifest?: boolean | undefined;
  filesIndexFile: string;
  pkg?: PkgNameVersion | undefined;
};

export type LocalTarballFetcherOptions = {
  readManifest?: boolean | undefined;
  filesIndexFile: string;
  pkg?: PkgNameVersion | undefined;
};

export type GitHostedTarballFetcherOptions = {
  readManifest?: boolean | undefined;
  filesIndexFile: string;
  pkg?: PkgNameVersion | undefined;
};

export type GitFetcherResult = {
  filesIndex: Record<string, string>;
  manifest?: DependencyManifest | undefined;
  requiresBuild: boolean;
  local?: boolean | undefined;
  packageImportMethod?: never | undefined;
};

export type LocalTarballFetcherResult = {
  filesIndex: Record<string, string>;
  manifest?: DependencyManifest | undefined;
  requiresBuild: boolean;
};

export type GitHostedTarballFetcherResult = {
  filesIndex: Record<string, string>;
  manifest?: DependencyManifest | undefined;
  requiresBuild: boolean;
};

export type GitFetcher = FetchFunction<
  GitResolution,
  GitFetcherOptions,
  GitFetcherResult
>;

export type LocalTarballFetcher = FetchFunction<
  LocalTarballResolution,
  LocalTarballFetcherOptions,
  LocalTarballFetcherResult
>;

export type GitHostedTarballFetcher = FetchFunction<
  GitHostedTarballResolution,
  GitHostedTarballFetcherOptions,
  GitHostedTarballFetcherResult
>;

export type DirectoryFetcherOptions = {
  lockfileDir: string;
  readManifest?: boolean | undefined;
};

export type DirectoryFetcherResult = {
  local: true;
  filesIndex: Record<string, string>;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  manifest?: DependencyManifest | undefined;
  requiresBuild: boolean;
};

export type DirectoryFetcher = FetchFunction<
  DirectoryResolution,
  DirectoryFetcherOptions,
  DirectoryFetcherResult
>;

export type Fetchers = {
  localTarball: FetchFunction;
  remoteTarball: FetchFunction;
  gitHostedTarball: FetchFunction;
  directory: DirectoryFetcher;
  git: GitFetcher;
};

type CustomFetcherFactoryOptions = {
  defaultFetchers: Fetchers;
};

export type CustomFetcherFactory<Fetcher> = (
  opts: CustomFetcherFactoryOptions
) => Fetcher;

export type CustomFetchers = {
  localTarball?: CustomFetcherFactory<FetchFunction> | undefined;
  remoteTarball?: CustomFetcherFactory<FetchFunction> | undefined;
  gitHostedTarball?: CustomFetcherFactory<FetchFunction> | undefined;
  directory?: CustomFetcherFactory<DirectoryFetcher> | undefined;
  git?: CustomFetcherFactory<GitFetcher> | undefined;
};
