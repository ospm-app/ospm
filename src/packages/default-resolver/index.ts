import { OspmError } from '../error/index.ts';
import type {
  FetchFromRegistry,
  GetAuthHeader,
} from '../fetching-types/index.ts';
import { createGitResolver } from '../git-resolver/index.ts';
import { resolveFromLocal } from '../local-resolver/index.ts';
import {
  type PackageMeta,
  createNpmResolver,
  type PackageMetaCache,
  type ResolverFactoryOptions,
} from '../npm-resolver/index.ts';
import type { WantedDependency } from '../resolve-dependencies/getWantedDependencies.ts';
import type {
  ResolveResult,
  ResolveOptions,
  ResolveFunction,
  WorkspaceResolveResult,
} from '../resolver-base/index.ts';
import { resolveFromTarball } from '../tarball-resolver/index.ts';

export type {
  PackageMeta,
  PackageMetaCache,
  ResolveFunction,
  ResolverFactoryOptions,
};

export function createResolver(
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: GetAuthHeader,
  ospmOpts: ResolverFactoryOptions
): { resolve: ResolveFunction; clearCache: () => void } {
  const { resolveFromNpm, clearCache } = createNpmResolver(
    fetchFromRegistry,
    getAuthHeader,
    ospmOpts
  );

  const resolveFromGit = createGitResolver(ospmOpts);

  return {
    resolve: async (
      wantedDependency: WantedDependency,
      opts: ResolveOptions
    ): Promise<ResolveResult | WorkspaceResolveResult> => {
      const resolution =
        (await resolveFromNpm(wantedDependency, opts)) ??
        (typeof wantedDependency.pref === 'string' &&
          ((await resolveFromTarball(fetchFromRegistry, {
            pref: wantedDependency.pref,
          })) ??
            (await resolveFromGit({ pref: wantedDependency.pref })) ??
            (await resolveFromLocal(
              {
                pref: wantedDependency.pref,
              },
              opts
            ))));

      if (resolution === false || resolution === null) {
        throw new OspmError(
          'SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER',
          `${typeof wantedDependency.alias === 'string' ? `${wantedDependency.alias}@` : ''}${wantedDependency.pref} isn't supported by any available resolver.`
        );
      }

      return resolution;
    },
    clearCache,
  };
}
