import { type LogBase, logger } from '../logger/index.ts';

export const summaryLogger = logger<SummaryMessage>('summary');

export type SummaryMessage = {
  prefix: string;
};

export type SummaryLog = { name: 'pnpm:summary' } & LogBase & SummaryMessage;
