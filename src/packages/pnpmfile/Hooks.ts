import type { PreResolutionHook } from '../hooks.types/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { Log } from '../core-loggers/index.ts';
import type { CustomFetchers } from '../fetcher-base/index.ts';
import type { ImportIndexedPackageAsync } from '../store-controller-types/index.ts';

export type HookContext = {
  log: (message: string) => void;
};

export type Hooks = {
  // eslint-disable-next-line
  readPackage?: ((pkg: any, context: HookContext) => any) | undefined;
  preResolution?: PreResolutionHook | undefined;
  afterAllResolved?:
    | ((
        lockfile: LockfileObject,
        context: HookContext
      ) => LockfileObject | Promise<LockfileObject>)
    | undefined;
  filterLog?: ((log: Log) => boolean) | undefined;
  importPackage?: ImportIndexedPackageAsync | undefined;
  fetchers?: CustomFetchers | undefined;
};
