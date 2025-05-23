import { type LogBase, logger } from '../logger/index.ts';

export const hookLogger = logger('hook');

export interface HookMessage {
  from: string;
  hook: string;
  message: string;
  prefix: string;
}

export type HookLog = { name: 'ospm:hook' } & LogBase & HookMessage;
