import { OspmError } from '../error/index.ts';

export type NodeSpecifier = {
  releaseChannel: string;
  useNodeVersion: string;
};

function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}
function matchPrereleaseVersion(version: string): RegExpMatchArray | null {
  return version.match(
    /^\d+\.\d+\.\d+-((rc)(\..+)|(test|v8-canary|nightly)(.+))$/
  );
}

const STABLE_RELEASE_ERROR_HINT =
  'The correct syntax for stable release is strictly X.Y.Z or release/X.Y.Z';

export function isValidVersion(specifier: string): boolean {
  if (specifier.includes('/')) {
    const [releaseChannel, useNodeVersion] = specifier.split('/');

    if (
      typeof releaseChannel !== 'string' ||
      typeof useNodeVersion !== 'string'
    ) {
      return false;
    }

    if (releaseChannel === 'release') {
      return isStableVersion(useNodeVersion);
    }

    return useNodeVersion.includes(releaseChannel);
  }

  return (
    isStableVersion(specifier) || matchPrereleaseVersion(specifier) != null
  );
}

export function parseNodeSpecifier(specifier: string): NodeSpecifier {
  if (specifier.includes('/')) {
    const [releaseChannel, useNodeVersion] = specifier.split('/');

    if (
      typeof releaseChannel !== 'string' ||
      typeof useNodeVersion !== 'string'
    ) {
      throw new OspmError(
        'INVALID_NODE_VERSION',
        `"${specifier}" is not a valid Node.js version`
      );
    }

    if (releaseChannel === 'release') {
      if (!isStableVersion(useNodeVersion)) {
        throw new OspmError(
          'INVALID_NODE_VERSION',
          `"${specifier}" is not a valid Node.js version`,
          {
            hint: STABLE_RELEASE_ERROR_HINT,
          }
        );
      }
    } else if (!useNodeVersion.includes(releaseChannel)) {
      throw new OspmError(
        'MISMATCHED_RELEASE_CHANNEL',
        `Node.js version (${useNodeVersion}) must contain the release channel (${releaseChannel})`
      );
    }

    return { releaseChannel, useNodeVersion };
  }

  const prereleaseMatch = matchPrereleaseVersion(specifier);

  if (prereleaseMatch !== null) {
    const m2 = prereleaseMatch[2];

    if (typeof m2 !== 'string') {
      throw new OspmError(
        'INVALID_NODE_VERSION',
        `"${specifier}" is not a valid Node.js version`
      );
    }

    return { releaseChannel: m2, useNodeVersion: specifier };
  }

  if (isStableVersion(specifier)) {
    return { releaseChannel: 'release', useNodeVersion: specifier };
  }

  let hint: string | undefined;
  if (['nightly', 'rc', 'test', 'v8-canary'].includes(specifier)) {
    hint = `The correct syntax for ${specifier} release is strictly X.Y.Z-${specifier}.W`;
  } else if (
    /^\d+\.\d+$/.test(specifier) ||
    /^\d+$/.test(specifier) ||
    ['release', 'stable', 'latest'].includes(specifier)
  ) {
    hint = STABLE_RELEASE_ERROR_HINT;
  }
  throw new OspmError(
    'INVALID_NODE_VERSION',
    `"${specifier}" is not a valid Node.js version`,
    { hint }
  );
}
