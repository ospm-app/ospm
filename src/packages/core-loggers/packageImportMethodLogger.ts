import { type LogBase, logger } from '../logger/index.ts';

export const packageImportMethodLogger = logger('package-import-method');

export type PackageImportMethodMessage = {
  method?: 'auto' | 'hardlink' | 'copy' | 'clone' | 'clone-or-copy' | undefined;
};

export type PackageImportMethodLog = {
  name: 'ospm:package-import-method';
} & LogBase &
  PackageImportMethodMessage;
