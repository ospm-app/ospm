import type { Config } from '../config/index.ts';
import { createResolver } from '../client/index.ts';

import { OspmError } from '../error/index.ts';
import { sortDeepKeys } from '../object.key-sorting/index.ts';
import { getStorePath } from '../store-path/index.ts';
import {
  getIndexFilePathInCafs,
  type PackageFilesIndex,
} from '../store.cafs/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';

import { loadJsonFile } from 'load-json-file';
import renderHelp from 'render-help';

export const skipPackageManagerCheck = true;

export const commandNames = ['cat-index'];

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export function help(): string {
  return renderHelp({
    description: 'Prints the index file of a specific package from the store.',
    descriptionLists: [],
    usages: ['ospm cat-index <pkg name>@<pkg version>'],
  });
}

export type CatIndexCommandOptions = Pick<
  Config,
  | 'rawConfig'
  | 'ospmHomeDir'
  | 'storeDir'
  | 'lockfileDir'
  | 'dir'
  | 'registries'
  | 'cacheDir'
  | 'sslConfigs'
>;

export async function handler(
  opts: CatIndexCommandOptions,
  params: string[]
): Promise<string> {
  if (params.length === 0) {
    throw new OspmError('MISSING_PACKAGE_NAME', 'Specify a package', {
      hint: help(),
    });
  }

  const wantedDependency = params[0];

  if (typeof wantedDependency === 'undefined') {
    throw new OspmError('MISSING_PACKAGE_NAME', 'Specify a package', {
      hint: help(),
    });
  }

  const { alias, pref } = parseWantedDependency(wantedDependency);

  if (typeof alias === 'undefined') {
    throw new OspmError(
      'INVALID_SELECTOR',
      `Cannot parse the "${wantedDependency}" selector`
    );
  }

  const storeDir = await getStorePath({
    pkgRoot: process.cwd(),
    storePath: opts.storeDir,
    ospmHomeDir: opts.ospmHomeDir,
  });

  const { resolve } = createResolver({
    ...opts,
    authConfig: opts.rawConfig,
  });

  const pkgSnapshot = await resolve(
    { alias, pref },
    {
      lockfileDir: opts.lockfileDir ?? opts.dir,
      preferredVersions: {},
      projectDir: opts.dir,
      registry: pickRegistryForPackage(opts.registries, alias, pref),
    }
  );

  if (typeof pkgSnapshot.resolution.integrity === 'undefined') {
    throw new OspmError(
      'MISSING_INTEGRITY',
      'No integrity found for the package'
    );
  }

  const filesIndexFile = getIndexFilePathInCafs(
    storeDir,
    pkgSnapshot.resolution.integrity,
    `${alias}@${pref}`
  );

  try {
    const pkgFilesIndex = await loadJsonFile<PackageFilesIndex>(filesIndexFile);

    return JSON.stringify(sortDeepKeys(pkgFilesIndex), null, 2);
  } catch {
    throw new OspmError(
      'INVALID_PACKAGE',
      'No corresponding index file found. You can use ospm list to see if the package is installed.'
    );
  }
}
