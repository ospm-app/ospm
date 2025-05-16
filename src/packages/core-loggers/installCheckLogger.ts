import { type LogBase, logger } from '../logger/index.ts';

export const installCheckLogger = logger<InstallCheckMessage>('install-check');

export type InstallCheckMessage = {
  code: string;
  pkgId: string;
};

export type InstallCheckLog = { name: 'ospm:install-check' } & LogBase &
  InstallCheckMessage;
