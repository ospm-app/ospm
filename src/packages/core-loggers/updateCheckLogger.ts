import { type LogBase, logger } from '../logger/index.ts';

export const updateCheckLogger = logger('update-check');

export type UpdateCheckMessage = {
  currentVersion: string;
  latestVersion: string;
};

export type UpdateCheckLog = { name: 'ospm:update-check' } & LogBase &
  UpdateCheckMessage;
