import path from 'node:path';
import { docsUrl } from '../cli-utils/index.ts';
import { type Config } from '../config/index.ts';
import { types as allTypes } from '../config/types.ts';
import {
  FULL_FILTERED_META_DIR,
  ABBREVIATED_META_DIR,
} from '../constants/index.ts';
import { getStorePath } from '../store-path/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import {
  cacheList,
  cacheView,
  cacheDelete,
  cacheListRegistries,
} from '../cache.api/index.ts';
import { OspmError } from '../error/index.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(['registry', 'store-dir'], allTypes),
  };
}

export const commandNames = ['cache'];

export function help(): string {
  return renderHelp({
    description: 'Inspect and manage the metadata cache',
    descriptionLists: [
      {
        title: 'Commands',

        list: [
          {
            description:
              'Lists the available packages metadata cache. Supports filtering by glob',
            name: 'list',
          },
          {
            description:
              'Lists all registries that have their metadata cache locally',
            name: 'list-registries',
          },
          {
            description: "Views information from the specified package's cache",
            name: 'view',
          },
          {
            description:
              'Deletes metadata cache for the specified package(s). Supports patterns',
            name: 'delete',
          },
        ],
      },
    ],
    url: docsUrl('cache'),
    usages: ['ospm cache <command>'],
  });
}

export type CacheCommandOptions = Pick<
  Config,
  | 'cacheDir'
  | 'storeDir'
  | 'ospmHomeDir'
  | 'cliOptions'
  | 'resolutionMode'
  | 'registrySupportsTimeField'
>;

export async function handler(
  opts: CacheCommandOptions,
  params: string[]
): Promise<string | undefined> {
  const cacheType =
    opts.resolutionMode === 'time-based' &&
    opts.registrySupportsTimeField !== true
      ? FULL_FILTERED_META_DIR
      : ABBREVIATED_META_DIR;

  const cacheDir = path.join(opts.cacheDir, cacheType);

  switch (params[0]) {
    case 'list-registries': {
      return cacheListRegistries({
        ...opts,
        cacheDir,
      });
    }

    case 'list': {
      return cacheList(
        {
          ...opts,
          cacheDir,
          registry: opts.cliOptions['registry'],
        },
        params.slice(1)
      );
    }

    case 'delete': {
      return cacheDelete(
        {
          ...opts,
          cacheDir,
          registry: opts.cliOptions['registry'],
        },
        params.slice(1)
      );
    }

    case 'view': {
      if (typeof params[1] === 'undefined') {
        throw new OspmError(
          'MISSING_PACKAGE_NAME',
          '`ospm cache view` requires the package name'
        );
      }

      if (params.length > 2) {
        throw new OspmError(
          'TOO_MANY_PARAMS',
          '`ospm cache view` only accepts one package name'
        );
      }

      const storeDir = await getStorePath({
        pkgRoot: process.cwd(),
        storePath: opts.storeDir,
        ospmHomeDir: opts.ospmHomeDir,
      });

      return cacheView(
        {
          ...opts,
          cacheDir,
          storeDir,
          registry: opts.cliOptions['registry'],
        },
        params[1]
      );
    }

    default: {
      return help();
    }
  }
}
