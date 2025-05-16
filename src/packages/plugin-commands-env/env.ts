import { docsUrl } from '../cli-utils/index.ts';
import { OspmError } from '../error/index.ts';
import renderHelp from 'render-help';
import { envRemove } from './envRemove.ts';
import { envUse } from './envUse.ts';
import type { NvmNodeCommandOptions } from './node.ts';
import { envList } from './envList.ts';
import { envAdd } from './envAdd.ts';

export const skipPackageManagerCheck = true;

export function rcOptionsTypes(): Record<string, unknown> {
  return {};
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    global: Boolean,
    remote: Boolean,
  };
}

export const commandNames = ['env'];

export function help(): string {
  return renderHelp({
    description: 'Manage Node.js versions.',
    descriptionLists: [
      {
        title: 'Commands',
        list: [
          {
            description:
              'Installs the specified version of Node.js. The npm CLI bundled with the given Node.js version gets installed as well. This sets this version of Node.js as the current version.',
            name: 'use',
          },
          {
            description:
              'Installs the specified version(s) of Node.js without activating them as the current version.',
            name: 'add',
          },
          {
            description: 'Removes the specified version(s) of Node.js.',
            name: 'remove',
            shortAlias: 'rm',
          },
          {
            description: 'List Node.js versions available locally or remotely',
            name: 'list',
            shortAlias: 'ls',
          },
        ],
      },
      {
        title: 'Options',
        list: [
          {
            description: 'Manages Node.js versions globally',
            name: '--global',
            shortAlias: '-g',
          },
          {
            description: 'List the remote versions of Node.js',
            name: '--remote',
          },
        ],
      },
    ],
    url: docsUrl('env'),
    usages: [
      'ospm env [command] [options] <version> [<additional-versions>...]',
      'ospm env use --global 18',
      'ospm env use --global lts',
      'ospm env use --global argon',
      'ospm env use --global latest',
      'ospm env use --global rc/18',
      'ospm env add --global 18',
      'ospm env add --global 18 19 20.6.0',
      'ospm env remove --global 18 lts',
      'ospm env remove --global argon',
      'ospm env remove --global latest',
      'ospm env remove --global rc/18 18 20.6.0',
      'ospm env list',
      'ospm env list --remote',
      'ospm env list --remote 18',
      'ospm env list --remote lts',
      'ospm env list --remote argon',
      'ospm env list --remote latest',
      'ospm env list --remote rc/18',
    ],
  });
}

export async function handler(
  opts: NvmNodeCommandOptions,
  params: string[]
): Promise<string | { exitCode: number }> {
  if (params.length === 0) {
    throw new OspmError('ENV_NO_SUBCOMMAND', 'Please specify the subcommand', {
      hint: help(),
    });
  }
  if (opts.global === true && !opts.bin) {
    throw new OspmError(
      'CANNOT_MANAGE_NODE',
      'Unable to manage Node.js because ospm was not installed using the standalone installation script',
      {
        hint: 'If you want to manage Node.js with ospm, you need to remove any Node.js that was installed by other tools, then install ospm using one of the standalone scripts that are provided on the installation page: https://ospm.app/cli-installation',
      }
    );
  }

  switch (params[0]) {
    case 'add': {
      return envAdd(opts, params.slice(1));
    }

    case 'use': {
      return envUse(opts, params.slice(1));
    }

    case 'remove':
    case 'rm':
    case 'uninstall':
    case 'un': {
      return envRemove(opts, params.slice(1));
    }

    case 'list':
    case 'ls': {
      return envList(opts, params.slice(1));
    }

    default: {
      throw new OspmError(
        'ENV_UNKNOWN_SUBCOMMAND',
        'This subcommand is not known'
      );
    }
  }
}
