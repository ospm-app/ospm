import type { ConfigCommandOptions } from './ConfigCommandOptions.ts';

export function configGet(opts: ConfigCommandOptions, key: string): string {
  const config = opts.rawConfig[key];
  return Array.isArray(config) ? config.join(',') : String(config);
}
