import { encode } from 'ini';
import sortKeys from 'sort-keys';
import type { ConfigCommandOptions } from './ConfigCommandOptions.ts';

export async function configList(opts: ConfigCommandOptions): Promise<string> {
  const sortedConfig = sortKeys(opts.rawConfig);

  if (opts.json === true) {
    return JSON.stringify(sortedConfig, null, 2);
  }

  return encode(sortedConfig);
}
