import { docsUrl } from '../cli-utils/index.ts';
import { PnpmError } from '../error/index.ts';
import renderHelp from 'render-help';
import { configGet } from './configGet.ts';
import { configSet } from './configSet.ts';
import { configList } from './configList.ts';
import type { ConfigCommandOptions } from './ConfigCommandOptions.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return {};
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    global: Boolean,
    location: ['global', 'project'],
    json: Boolean,
  };
}

export const commandNames = ['config', 'c'];

export function help(): string {
  return renderHelp({
    description: 'Manage the pnpm configuration files.',
    descriptionLists: [
      {
        title: 'Commands',
        list: [
          {
            description: 'Set the config key to the value provided',
            name: 'set',
          },
          {
            description: 'Print the config value for the provided key',
            name: 'get',
          },
          {
            description: 'Remove the config key from the config file',
            name: 'delete',
          },
          {
            description: 'Show all the config settings',
            name: 'list',
          },
        ],
      },
      {
        title: 'Options',
        list: [
          {
            description: 'Sets the configuration in the global config file',
            name: '--global',
            shortAlias: '-g',
          },
          {
            description:
              'When set to "project", the .npmrc file at the nearest package.json will be used',
            name: '--location <project|global>',
          },
          {
            description: 'Show all the config settings in JSON format',
            name: '--json',
          },
        ],
      },
    ],
    url: docsUrl('config'),
    usages: [
      'pnpm config set <key> <value>',
      'pnpm config get <key>',
      'pnpm config delete <key>',
      'pnpm config list',
      'pnpm config list --json',
    ],
  });
}

export async function handler(
  opts: ConfigCommandOptions,
  params: string[]
  // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
): Promise<string | void> {
  if (params.length === 0) {
    throw new PnpmError(
      'CONFIG_NO_SUBCOMMAND',
      'Please specify the subcommand',
      {
        hint: help(),
      }
    );
  }

  if (opts.location) {
    opts.global = opts.location === 'global';
  } else if (opts.cliOptions['global'] == null) {
    opts.global = true;
  }

  switch (params[0]) {
    case 'set':
    case 'delete': {
      if (typeof params[1] === 'undefined') {
        throw new PnpmError(
          'CONFIG_NO_PARAMS',
          `\`pnpm config ${params[0]}\` requires the config key`
        );
      }

      if (params[0] === 'set') {
        let [key, value] = params.slice(1);

        if (value == null) {
          const parts = key?.split('=');
          key = parts?.shift();
          value = parts?.join('=');
        }

        if (typeof key !== 'undefined') {
          return configSet(opts, key, value ?? '');
        }

        return;
      }

      return configSet(opts, params[1], null);
    }

    case 'get': {
      if (typeof params[1] !== 'undefined') {
        return configGet(opts, params[1]);
      }

      return configList(opts);
    }

    case 'list': {
      return configList(opts);
    }

    default: {
      throw new PnpmError(
        'CONFIG_UNKNOWN_SUBCOMMAND',
        'This subcommand is not known'
      );
    }
  }
}
