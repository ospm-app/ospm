import type {
  // Fetchers,
  GitFetcher,
  FetchOptions,
  FetchFunction,
  DirectoryFetcher,
  LocalTarballFetcher,
  GitHostedTarballFetcher,
} from '../fetcher-base/index.ts';
import type { PackageFiles } from '../cafs-types/index.ts';
import type { Resolution } from '../resolver-base/index.ts';
import type { DependencyManifest } from '../types/package.ts';
import type { TarballFetchers } from '../tarball-fetcher/index.ts';

export function pickFetcher(
  fetcherByHostingType: TarballFetchers,
  resolution: Resolution
):
  | FetchFunction<
      Resolution,
      FetchOptions,
      {
        filesIndex: PackageFiles | Record<string, string>;
        manifest: DependencyManifest | undefined;
        requiresBuild: boolean;
      }
    >
  | DirectoryFetcher
  | GitFetcher
  | LocalTarballFetcher
  | GitHostedTarballFetcher {
  let fetcherType:
    | 'directory'
    | 'git'
    | 'localTarball'
    | 'gitHostedTarball'
    | 'remoteTarball'
    | undefined = 'type' in resolution ? resolution.type : undefined;

  if (!('type' in resolution)) {
    if (resolution.tarball?.startsWith('file:') === true) {
      fetcherType = 'localTarball';
    } else if (isGitHostedPkgUrl(resolution.tarball ?? '')) {
      fetcherType = 'gitHostedTarball';
    } else {
      fetcherType = 'remoteTarball';
    }
  }

  if (typeof fetcherType === 'undefined') {
    throw new Error(
      `Fetching for dependency type "${'type' in resolution ? resolution.type : 'undefined'}" is not supported`
    );
  }

  // if (!fetch) {
  //   throw new Error(
  //     `Fetching for dependency type "${resolution.type ?? 'undefined'}" is not supported`
  //   );
  // }

  return fetcherByHostingType[fetcherType as keyof typeof fetcherByHostingType];
}

export function isGitHostedPkgUrl(url: string | undefined): boolean {
  if (typeof url === 'undefined') {
    return false;
  }

  return (
    (url.startsWith('https://codeload.github.com/') ||
      url.startsWith('https://bitbucket.org/') ||
      url.startsWith('https://gitlab.com/')) &&
    url.includes('tar.gz')
  );
}
