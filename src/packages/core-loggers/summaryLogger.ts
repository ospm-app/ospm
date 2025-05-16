import { type LogBase, logger } from '../logger/index.ts';

export const summaryLogger = logger<SummaryMessage>('summary');

export type SummaryMessage = {
  prefix: string;
};

export type SummaryLog = { name: 'ospm:summary' } & LogBase & SummaryMessage;
