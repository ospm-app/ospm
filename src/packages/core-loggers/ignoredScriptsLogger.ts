import { type LogBase, logger } from '../logger/index.ts';

export const ignoredScriptsLogger = logger('ignored-scripts');

export interface IgnoredScriptsMessage {
  packageNames: string[];
}

export type IgnoredScriptsLog = { name: 'ospm:ignored-scripts' } & LogBase &
  IgnoredScriptsMessage;
