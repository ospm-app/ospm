import { docsUrl } from '../cli-utils/index.ts';
import {
  FILTERING,
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { types as allTypes } from '../config/types.ts';
import { OspmError } from '../error/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { handler as list, type ListCommandOptions } from './list.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default(
    [
      'depth',
      'dev',
      'global-dir',
      'global',
      'json',
      'long',
      'only',
      'optional',
      'parseable',
      'production',
    ],
    allTypes
  );
}

export const cliOptionsTypes = (): Record<string, unknown> => ({
  ...rcOptionsTypes(),
  recursive: Boolean,
});

export const shorthands: Record<string, string> = {
  D: '--dev',
  P: '--production',
};

export const commandNames = ['why'];

export function help(): string {
  return renderHelp({
    description: `Shows the packages that depend on <pkg>
For example: ospm why babel-* eslint-*`,
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Perform command on every package in subdirectories \
or on every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "ospm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description: 'Show extended information',
            name: '--long',
          },
          {
            description: 'Show parseable output instead of tree view',
            name: '--parseable',
          },
          {
            description: 'Show information in JSON format',
            name: '--json',
          },
          {
            description:
              'List packages in the global install prefix instead of in the current project',
            name: '--global',
            shortAlias: '-g',
          },
          {
            description:
              'Display only the dependency graph for packages in `dependencies` and `optionalDependencies`',
            name: '--prod',
            shortAlias: '-P',
          },
          {
            description:
              'Display only the dependency graph for packages in `devDependencies`',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description: "Don't display packages from `optionalDependencies`",
            name: '--no-optional',
          },
          {
            name: '--depth <number>',
            description: 'Max display depth of the dependency graph',
          },
          OPTIONS.globalDir,
          ...UNIVERSAL_OPTIONS,
        ],
      },
      FILTERING,
    ],
    url: docsUrl('why'),
    usages: ['ospm why <pkg> ...'],
  });
}

export async function handler(
  opts: ListCommandOptions,
  params: string[]
): Promise<string> {
  if (params.length === 0) {
    throw new OspmError(
      'MISSING_PACKAGE_NAME',
      '`ospm why` requires the package name'
    );
  }

  return list(
    {
      ...opts,
      cliOptions: {
        ...(opts.cliOptions ?? {}),
        depth: opts.depth ?? Number.POSITIVE_INFINITY,
      },
    },
    params
  );
}
