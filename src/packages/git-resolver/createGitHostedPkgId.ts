import type { PkgResolutionId } from '../types/misc.ts';

export function createGitHostedPkgId({
  repo,
  commit,
  path,
}: {
  repo?: string;
  commit?: string;
  path?: string | undefined;
}): PkgResolutionId {
  let id = `${repo?.includes('://') === true ? '' : 'https://'}${repo}#${commit}`;

  if (!id.startsWith('git+')) {
    id = `git+${id}`;
  }

  if (typeof path === 'string') {
    id += `&path:${path}`;
  }

  return id as PkgResolutionId;
}
