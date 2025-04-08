import * as configCmd from './config.ts';
import type { ConfigCommandOptions } from './ConfigCommandOptions.ts';

export const rcOptionsTypes = configCmd.rcOptionsTypes;
export const cliOptionsTypes = configCmd.cliOptionsTypes;
export const help = configCmd.help;

export const commandNames = ['set'];

export async function handler(
  opts: ConfigCommandOptions,
  params: string[]
  // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
): Promise<string | void> {
  return configCmd.handler(opts, ['set', ...params]);
}
