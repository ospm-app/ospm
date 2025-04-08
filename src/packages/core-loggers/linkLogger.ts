import { type LogBase, logger } from '../logger/index.ts';

export const linkLogger = logger<LinkMessage>('link');

export type LinkMessage = {
  target: string;
  link: string;
};

export type LinkLog = { name: 'pnpm:link' } & LogBase & LinkMessage;
