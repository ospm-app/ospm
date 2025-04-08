import { docsUrl } from '../cli-utils/index.ts';
import {
  UNIVERSAL_OPTIONS,
  OPTIONS,
} from '../common-cli-options-help/index.ts';
import { types as allTypes } from '../config/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import * as install from './install.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return pick.default(
    ['dev', 'optional', 'production', 'ignore-scripts'],
    allTypes
  );
}

export const commandNames = ['prune'];

export function help(): string {
  return renderHelp({
    description: 'Removes extraneous packages',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description: 'Remove the packages specified in `devDependencies`',
            name: '--prod',
          },
          {
            description:
              'Remove the packages specified in `optionalDependencies`',
            name: '--no-optional',
          },
          OPTIONS.ignoreScripts,
          ...UNIVERSAL_OPTIONS,
        ],
      },
    ],
    url: docsUrl('prune'),
    usages: ['pnpm prune [--prod]'],
  });
}

export async function handler(
  opts: install.InstallCommandOptions
): Promise<void> {
  return install.handler({
    ...opts,
    modulesCacheMaxAge: 0,
    pruneDirectDependencies: true,
    pruneStore: true,
  });
}
