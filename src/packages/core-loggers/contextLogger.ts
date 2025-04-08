import { type LogBase, logger } from '../logger/index.ts';

export const contextLogger = logger('context');

export interface ContextMessage {
  currentLockfileExists: boolean;
  storeDir: string;
  virtualStoreDir: string;
}

export type ContextLog = { name: 'pnpm:context' } & LogBase & ContextMessage;
