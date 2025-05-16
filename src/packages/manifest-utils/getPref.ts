import { OspmError } from '../error/index.ts';

export type PinnedVersion = 'major' | 'minor' | 'patch' | 'none';

export const getPrefix = (alias: string, name: string): string =>
  alias !== name ? `npm:${name}@` : '';

export function getPref(
  alias: string,
  name: string,
  version: string | undefined,
  opts: {
    pinnedVersion?: PinnedVersion;
  }
): string {
  const prefix = getPrefix(alias, name);
  return `${prefix}${createVersionSpec(version, { pinnedVersion: opts.pinnedVersion })}`;
}

export function createVersionSpec(
  version: string | undefined,
  opts: {
    pinnedVersion?: PinnedVersion | undefined;
    rolling?: boolean | undefined;
  }
): string {
  switch (opts.pinnedVersion ?? 'major') {
    case 'none':
    case 'major': {
      if (opts.rolling === true) {
        return '^';
      }

      return typeof version === 'string' ? `^${version}` : '*';
    }

    case 'minor': {
      if (opts.rolling === true) {
        return '~';
      }
      return typeof version === 'string' ? `~${version}` : '*';
    }

    case 'patch': {
      if (opts.rolling === true) {
        return '*';
      }
      return typeof version === 'string' ? `${version}` : '*';
    }

    default: {
      throw new OspmError(
        'BAD_PINNED_VERSION',
        `Cannot pin '${opts.pinnedVersion ?? 'undefined'}'`
      );
    }
  }
}
