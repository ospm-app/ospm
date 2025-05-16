import { docsUrl, readDepNameCompletions } from '../cli-utils/index.ts';
import type { CompletionFunc } from '../command/index.ts';
import { FILTERING } from '../common-cli-options-help/index.ts';
import { types as allTypes } from '../config/types.ts';
import { OspmError } from '../error/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import type { LicensesCommandResult } from './LicensesCommandResult.ts';
import { licensesList, type LicensesCommandOptions } from './licensesList.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(
      ['dev', 'global-dir', 'global', 'json', 'long', 'optional', 'production'],
      allTypes
    ),
    compatible: Boolean,
    table: Boolean,
  };
}

export const cliOptionsTypes = (): Record<string, unknown> => ({
  ...rcOptionsTypes(),
  recursive: Boolean,
});

export const shorthands: Record<string, string> = {
  D: '--dev',
  P: '--production',
};

export const commandNames = ['licenses'];

export function help(): string {
  return renderHelp({
    description: 'Check the licenses of the installed packages.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Show more details (such as a link to the repo) are not displayed. \
To display the details, pass this option.',
            name: '--long',
          },
          {
            description: 'Show information in JSON format',
            name: '--json',
          },
          {
            description: 'Check only "dependencies" and "optionalDependencies"',
            name: '--prod',
            shortAlias: '-P',
          },
          {
            description: 'Check only "devDependencies"',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description: 'Don\'t check "optionalDependencies"',
            name: '--no-optional',
          },
        ],
      },
      FILTERING,
    ],
    url: docsUrl('licenses'),
    usages: [
      'ospm licenses ls',
      'ospm licenses ls --long',
      'ospm licenses list',
      'ospm licenses list --long',
    ],
  });
}

export const completion: CompletionFunc = async (cliOpts) => {
  return readDepNameCompletions(cliOpts.dir as string);
};

export async function handler(
  opts: LicensesCommandOptions,
  params: string[] = []
): Promise<LicensesCommandResult> {
  if (params.length === 0) {
    throw new OspmError(
      'LICENCES_NO_SUBCOMMAND',
      'Please specify the subcommand',
      {
        hint: help(),
      }
    );
  }
  switch (params[0]) {
    case 'list':
    case 'ls':
      return licensesList(opts);
    default: {
      throw new OspmError(
        'LICENSES_UNKNOWN_SUBCOMMAND',
        'This subcommand is not known'
      );
    }
  }
}
