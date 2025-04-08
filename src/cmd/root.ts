import path from 'node:path';
import { types as allTypes } from '../packages/config/index.ts';
import { docsUrl } from '../packages/cli-utils/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return pick.default(['global'], allTypes);
}

export const commandNames = ['root'];

export function help(): string {
  return renderHelp({
    description: 'Print the effective `node_modules` directory.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description: 'Print the global `node_modules` directory',
            name: '--global',
            shortAlias: '-g',
          },
        ],
      },
    ],
    url: docsUrl('root'),
    usages: ['pnpm root [-g]'],
  });
}

export async function handler(opts: {
  dir: string;
}): Promise<string> {
  return `${path.join(opts.dir, 'node_modules')}\n`;
}
