import { type LogBase, logger } from '../logger/index.ts';

export const statsLogger = logger<StatsMessage>('stats');

export type StatsMessageBase = {
  prefix: string;
  added?: number | undefined;
  removed?: number | undefined;
};

export interface StatsMessageAdded extends StatsMessageBase {
  added: number;
  removed?: never | undefined;
}

export interface StatsMessageRemoved extends StatsMessageBase {
  added?: never | undefined;
  removed: number;
}

export type StatsMessage = StatsMessageAdded | StatsMessageRemoved;

export type StatsLog = { name: 'pnpm:stats' } & LogBase & StatsMessage;
