import { parseRange } from 'semver-utils';

export type PinnedVersion = 'none' | 'patch' | 'minor' | 'major';

export function whichVersionIsPinned(spec: string): PinnedVersion | undefined {
  const isWorkspaceProtocol = spec.startsWith('workspace:');

  let newSpec = spec;

  if (isWorkspaceProtocol) {
    newSpec = newSpec.slice('workspace:'.length);
  }

  if (newSpec === '*') return isWorkspaceProtocol ? 'patch' : 'none';

  if (newSpec.startsWith('npm:')) {
    const index = newSpec.lastIndexOf('@');
    newSpec = newSpec.slice(index + 1);
  }

  const parsedRange = parseRange(newSpec);

  if (parsedRange.length !== 1) {
    return undefined;
  }

  const versionObject = parsedRange[0];

  switch (versionObject?.operator) {
    case '~': {
      return 'minor';
    }

    case '^': {
      return 'major';
    }

    case undefined: {
      if (typeof versionObject?.patch === 'string') {
        return 'patch';
      }

      if (typeof versionObject?.minor === 'string') {
        return 'minor';
      }
    }
  }

  return undefined;
}
