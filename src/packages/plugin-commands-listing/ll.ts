import omit from 'ramda/src/omit';
import * as list from './list.ts';

export const commandNames = ['ll', 'la'];

export const rcOptionsTypes = list.rcOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return omit.default(['long'], list.cliOptionsTypes());
}

export const help = list.help;

export async function handler(
  opts: list.ListCommandOptions,
  params: string[]
): Promise<string> {
  return list.handler({ ...opts, long: true }, params);
}
