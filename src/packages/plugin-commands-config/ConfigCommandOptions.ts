import type { Config } from '../config/index.ts';

export type ConfigCommandOptions = Pick<
  Config,
  'configDir' | 'cliOptions' | 'dir' | 'global' | 'npmPath' | 'rawConfig'
> & {
  json?: boolean;
  location?: 'global' | 'project';
};
