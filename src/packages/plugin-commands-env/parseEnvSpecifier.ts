import { PnpmError } from '../error/index.ts';

export type EnvSpecifier = {
  releaseChannel: string;
  versionSpecifier: string;
};

export function parseEnvSpecifier(specifier: string): EnvSpecifier {
  if (specifier.includes('/')) {
    const [releaseChannel, versionSpecifier] = specifier.split('/');

    if (
      typeof releaseChannel === 'undefined' ||
      typeof versionSpecifier === 'undefined'
    ) {
      throw new PnpmError(
        'INVALID_ENV_SPECIFIER',
        `"${specifier}" is not a valid environment specifier`
      );
    }

    return { releaseChannel, versionSpecifier };
  }
  const prereleaseMatch = specifier.match(/-(nightly|rc|test|v8-canary)/);
  if (prereleaseMatch != null) {
    return {
      releaseChannel: prereleaseMatch[1] ?? '',
      versionSpecifier: specifier,
    };
  }
  if (['nightly', 'rc', 'test', 'release', 'v8-canary'].includes(specifier)) {
    return { releaseChannel: specifier, versionSpecifier: 'latest' };
  }
  return { releaseChannel: 'release', versionSpecifier: specifier };
}
