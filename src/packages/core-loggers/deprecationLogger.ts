import { type LogBase, type Logger, logger } from '../logger/index.ts';

export const deprecationLogger = logger(
  'deprecation'
) as Logger<DeprecationMessage>;

export interface DeprecationMessage {
  pkgName: string;
  pkgVersion: string;
  pkgId: string;
  prefix: string;
  deprecated: string;
  depth: number;
}

export type DeprecationLog = { name: 'pnpm:deprecation' } & LogBase &
  DeprecationMessage;
