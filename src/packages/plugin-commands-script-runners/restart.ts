import { types as allTypes } from '../config/types.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import {
  handler as run,
  IF_PRESENT_OPTION,
  IF_PRESENT_OPTION_HELP,
  type RunOpts,
} from './run.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(['npm-path'], allTypes),
  };
}

export function cliOptionsTypes(): Record<string, unknown> {
  return IF_PRESENT_OPTION;
}

export const commandNames = ['restart'];

export function help(): string {
  return renderHelp({
    description:
      'Restarts a package. Runs a package\'s "stop", "restart", and "start" scripts, and associated pre- and post- scripts.',
    descriptionLists: [
      {
        title: 'Options',

        list: [IF_PRESENT_OPTION_HELP],
      },
    ],
    usages: ['ospm restart [-- <args>...]'],
  });
}

export async function handler(opts: RunOpts, params: string[]): Promise<void> {
  await run(opts, ['stop', ...params]);

  await run(opts, ['restart', ...params]);

  await run(opts, ['start', ...params]);
}
