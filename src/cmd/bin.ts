import { docsUrl } from '../packages/cli-utils/index.ts';
import { types as allTypes } from '../packages/config/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return pick.default(['global'], allTypes);
}

export const commandNames = ['bin'];

export function help(): string {
  return renderHelp({
    description: 'Print the directory where pnpm will install executables.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description: 'Print the global executables directory',
            name: '--global',
            shortAlias: '-g',
          },
        ],
      },
    ],
    url: docsUrl('bin'),
    usages: ['pnpm bin [-g]'],
  });
}

export async function handler(opts: {
  bin: string;
}): Promise<string> {
  return opts.bin;
}
