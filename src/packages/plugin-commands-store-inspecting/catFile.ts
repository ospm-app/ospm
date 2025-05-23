import path from 'node:path';
import util from 'node:util';

import type { Config } from '../config/index.ts';
import { OspmError } from '../error/index.ts';
import gfs from '../graceful-fs/index.ts';
import { getStorePath } from '../store-path/index.ts';

import renderHelp from 'render-help';

// eslint-disable-next-line optimize-regex/optimize-regex
const INTEGRITY_REGEX: RegExp = /^([^-]+)-([A-Za-z0-9+/=]+)$/;

export const skipPackageManagerCheck = true;

export const commandNames = ['cat-file'];

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export function help(): string {
  return renderHelp({
    description:
      'Prints the contents of a file based on the hash value stored in the index file.',
    descriptionLists: [],
    usages: ['ospm cat-file <hash>'],
  });
}

export type CatFileCommandOptions = Pick<Config, 'storeDir' | 'ospmHomeDir'>;

export async function handler(
  opts: CatFileCommandOptions,
  params: string[]
): Promise<string> {
  if (params.length === 0) {
    throw new OspmError('MISSING_HASH', 'Missing file hash', {
      hint: help(),
    });
  }

  if (typeof params[0] !== 'string') {
    throw new OspmError('INVALID_HASH', 'Invalid file hash', {
      hint: help(),
    });
  }

  const match = params[0].match(INTEGRITY_REGEX);

  if (match === null) {
    throw new OspmError('INVALID_HASH', 'Invalid file hash', {
      hint: help(),
    });
  }

  const [, , integrityHash] = match;

  if (typeof integrityHash !== 'string') {
    throw new OspmError('INVALID_HASH', 'Invalid file hash', {
      hint: help(),
    });
  }

  const toHex = Buffer.from(integrityHash, 'base64').toString('hex');

  const storeDir = await getStorePath({
    pkgRoot: process.cwd(),
    storePath: opts.storeDir,
    ospmHomeDir: opts.ospmHomeDir,
  });

  const cafsDir = path.join(storeDir, 'files');

  const filePath = path.resolve(cafsDir, toHex.slice(0, 2), toHex.slice(2));

  try {
    return gfs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      throw new OspmError('INVALID_HASH', 'Corresponding hash file not found');
    }

    throw err;
  }
}
