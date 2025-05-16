import { docsUrl } from '../cli-utils/index.ts';
import {
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { types as allTypes } from '../config/types.ts';
import { OspmError } from '../error/index.ts';
import type { CreateStoreControllerOptions } from '../store-connection-manager/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { start } from './start.ts';
import { status } from './status.ts';
import { stop } from './stop.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(['store-dir'], allTypes),
    background: Boolean,
    'ignore-stop-requests': Boolean,
    'ignore-upload-requests': Boolean,
    port: Number,
    protocol: ['auto', 'tcp', 'ipc'],
  };
}

export const commandNames = ['server'];

export function help(): string {
  return renderHelp({
    description: 'Manage a store server',
    descriptionLists: [
      {
        title: 'Commands',

        list: [
          {
            description:
              '\
Starts a service that does all interactions with the store. \
Other commands will delegate any store-related tasks to this service',
            name: 'start',
          },
          {
            description: 'Stops the store server',
            name: 'stop',
          },
          {
            description: 'Prints information about the running server',
            name: 'status',
          },
        ],
      },
      {
        title: 'Start options',

        list: [
          {
            description: 'Runs the server in the background',
            name: '--background',
          },
          {
            description: 'The communication protocol used by the server',
            name: '--protocol <auto|tcp|ipc>',
          },
          {
            description:
              'The port number to use, when TCP is used for communication',
            name: '--port <number>',
          },
          OPTIONS.storeDir,
          {
            description: 'Maximum number of concurrent network requests',
            name: '--network-concurrency <number>',
          },
          {
            description:
              "If false, doesn't check whether packages in the store were mutated",
            name: '--[no-]verify-store-integrity',
          },
          {
            name: '--[no-]lock',
          },
          {
            description:
              'Disallows stopping the server using `ospm server stop`',
            name: '--ignore-stop-requests',
          },
          {
            description:
              'Disallows creating new side effect cache during install',
            name: '--ignore-upload-requests',
          },
          ...UNIVERSAL_OPTIONS,
        ],
      },
    ],
    url: docsUrl('server'),
    usages: ['ospm server <command>'],
  });
}

export function handler(
  opts: CreateStoreControllerOptions & {
    protocol?: 'auto' | 'tcp' | 'ipc' | undefined;
    port?: number | undefined;
    unstoppable?: boolean | undefined;
  },
  params: string[]
): Promise<void> | undefined {
  // We can only support TCP at the moment because node-fetch does not support IPC
  opts.protocol = 'tcp';

  switch (params[0]) {
    case 'start': {
      return start(opts);
    }

    case 'status': {
      return status(opts);
    }

    case 'stop': {
      return stop(opts);
    }

    default: {
      help();

      if (typeof params[0] !== 'undefined') {
        throw new OspmError(
          'INVALID_SERVER_COMMAND',
          `"server ${params[0]}" is not a ospm command. See "ospm help server".`
        );
      }

      return undefined;
    }
  }
}
