import { type LogBase, logger } from '../logger/index.ts';

export const executionTimeLogger = logger('execution-time');

export interface ExecutionTimeMessage {
  startedAt: number;
  endedAt: number;
}

export type ExecutionTimeLog = { name: 'ospm:execution-time' } & LogBase &
  ExecutionTimeMessage;
