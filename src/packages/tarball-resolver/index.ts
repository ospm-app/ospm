import type {
  ResolveResult,
  WorkspaceResolveResult,
} from '../resolver-base/index.ts';
import type { FetchFromRegistry } from '../fetching-types/index.ts';
import type { PkgResolutionId } from '../types/index.ts';

export async function resolveFromTarball(
  fetchFromRegistry: FetchFromRegistry,
  wantedDependency: { pref: string }
): Promise<ResolveResult | WorkspaceResolveResult | null> {
  if (
    !wantedDependency.pref.startsWith('http:') &&
    !wantedDependency.pref.startsWith('https:')
  ) {
    return null;
  }

  if (isRepository(wantedDependency.pref)) {
    return null;
  }

  // If there are redirects, we want to get the final URL address
  const { url: resolvedUrl } = await fetchFromRegistry(wantedDependency.pref, {
    method: 'HEAD',
  });

  return {
    id: resolvedUrl as PkgResolutionId,
    normalizedPref: resolvedUrl,
    resolution: {
      tarball: resolvedUrl,
    },
    resolvedVia: 'url',
  };
}

const GIT_HOSTERS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

function isRepository(pref: string): boolean {
  let newPref = pref;

  const url = new URL(newPref);

  if (url.hash !== '' && url.hash.includes('/')) {
    url.hash = encodeURIComponent(url.hash.substring(1));

    newPref = url.href;
  }

  if (newPref.endsWith('/')) {
    newPref = newPref.slice(0, -1);
  }

  const parts = newPref.split('/');

  return parts.length === 5 && GIT_HOSTERS.has(parts[2] ?? '');
}
