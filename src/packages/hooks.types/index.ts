import type { LockfileObject } from '../lockfile.types/index.ts';
import type { LockFileDir, Registries } from '../types/index.ts';

export type PreResolutionHookContext = {
  wantedLockfile: LockfileObject;
  currentLockfile: LockfileObject;
  existsCurrentLockfile: boolean;
  existsNonEmptyWantedLockfile: boolean;
  lockfileDir?: LockFileDir | undefined;
  storeDir: string;
  registries: Registries;
};

export type PreResolutionHookLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type PreResolutionHook = (
  ctx: PreResolutionHookContext,
  logger: PreResolutionHookLogger
) => Promise<void>;
