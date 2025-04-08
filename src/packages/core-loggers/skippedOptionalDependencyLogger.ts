import { type LogBase, logger } from '../logger/index.ts';

export const skippedOptionalDependencyLogger =
  logger<SkippedOptionalDependencyMessage>('skipped-optional-dependency');

export type SkippedOptionalDependencyLog = {
  name: 'pnpm:skipped-optional-dependency';
} & LogBase &
  SkippedOptionalDependencyMessage;

export type SkippedOptionalDependencyMessage = {
  details?: string | undefined;
  parents?: Array<{ id: string; name: string; version: string }> | undefined;
  prefix: string;
} & (
  | {
      package: {
        id: string;
        name?: string | undefined;
        version?: string | undefined;
      };

      reason: 'unsupported_engine' | 'unsupported_platform' | 'build_failure';
    }
  | {
      package: {
        name: string | undefined;
        version: string | undefined;
        pref?: string | undefined;
      };

      reason: 'resolution_failure';
    }
);
