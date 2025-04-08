import type {
  PreResolutionHookContext,
  PreResolutionHookLogger,
} from '../hooks.types/index.ts';
import { hookLogger } from '../core-loggers/index.ts';
import { createHashFromFile } from '../crypto.hash/index.ts';
import pathAbsolute from 'path-absolute';
import type { CustomFetchers } from '../fetcher-base/index.ts';
import type { ImportIndexedPackageAsync } from '../store-controller-types/index.ts';
import { getPnpmfilePath } from './getPnpmfilePath.ts';
import { requirePnpmfile } from './requirePnpmfile.ts';
import type { HookContext, Hooks } from './Hooks.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cook<T extends (...args: any[]) => any> = (
  arg: Parameters<T>[0],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...otherArgs: any[]
) => ReturnType<T>;

export type CookedHooks = {
  readPackage?:
    | Array<Cook<Exclude<Required<Hooks>['readPackage'], undefined>>>
    | undefined;
  preResolution?:
    | Cook<Exclude<Required<Hooks>['preResolution'], undefined>>
    | undefined;
  afterAllResolved?:
    | Array<Cook<Exclude<Required<Hooks>['afterAllResolved'], undefined>>>
    | undefined;
  filterLog?:
    | Array<Cook<Exclude<Required<Hooks>['filterLog'], undefined>>>
    | undefined;
  importPackage?: ImportIndexedPackageAsync | undefined;
  fetchers?: CustomFetchers | undefined;
  calculatePnpmfileChecksum?: (() => Promise<string | undefined>) | undefined;
};

export function requireHooks(
  prefix: string,
  opts: {
    globalPnpmfile?: string | undefined;
    pnpmfile?: string | undefined;
  }
): CookedHooks {
  const globalPnpmfile =
    typeof opts.globalPnpmfile === 'string'
      ? requirePnpmfile(pathAbsolute(opts.globalPnpmfile, prefix), prefix)
      : undefined;

  let globalHooks: Hooks | undefined = globalPnpmfile?.hooks;

  const pnpmfilePath = getPnpmfilePath(prefix, opts.pnpmfile);

  const pnpmFile = requirePnpmfile(pnpmfilePath, prefix);

  let hooks: Hooks | undefined = pnpmFile?.hooks;

  if (!globalHooks && !hooks) {
    return { afterAllResolved: [], filterLog: [], readPackage: [] };
  }

  const calculatePnpmfileChecksum = hooks
    ? () => createHashFromFile(pnpmfilePath)
    : undefined;

  globalHooks = globalHooks ?? {};

  hooks = hooks ?? {};

  const cookedHooks: CookedHooks & Required<Pick<CookedHooks, 'filterLog'>> = {
    afterAllResolved: [],
    filterLog: [],
    readPackage: [],
    calculatePnpmfileChecksum,
  };

  for (const hookName of ['readPackage', 'afterAllResolved'] as const) {
    if (globalHooks[hookName]) {
      const globalHook = globalHooks[hookName];

      const context = createReadPackageHookContext(
        globalPnpmfile?.filename ?? '',
        prefix,
        hookName
      );

      cookedHooks[hookName]?.push((pkg: LockfileObject) => {
        return globalHook(pkg, context);
      });
    }

    if (hooks[hookName]) {
      const hook = hooks[hookName];
      const context = createReadPackageHookContext(
        pnpmFile?.filename ?? '',
        prefix,
        hookName
      );

      cookedHooks[hookName]?.push((pkg: LockfileObject) => hook(pkg, context));
    }
  }
  if (globalHooks.filterLog != null) {
    cookedHooks.filterLog?.push(globalHooks.filterLog);
  }
  if (hooks.filterLog != null) {
    cookedHooks.filterLog?.push(hooks.filterLog);
  }

  // `importPackage`, `preResolution` and `fetchers` can only be defined via a global pnpmfile

  cookedHooks.importPackage = globalHooks.importPackage;

  const preResolutionHook = globalHooks.preResolution;

  cookedHooks.preResolution = preResolutionHook
    ? (ctx: PreResolutionHookContext) =>
        preResolutionHook(ctx, createPreResolutionHookLogger(prefix))
    : undefined;

  cookedHooks.fetchers = globalHooks.fetchers;

  return cookedHooks;
}

function createReadPackageHookContext(
  calledFrom: string,
  prefix: string,
  hook: string
): HookContext {
  return {
    log: (message: string) => {
      hookLogger.debug({
        from: calledFrom,
        hook,
        message,
        prefix,
      });
    },
  };
}

function createPreResolutionHookLogger(
  prefix: string
): PreResolutionHookLogger {
  const hook = 'preResolution';

  return {
    info: (message: string) =>
      hookLogger.info({ message, prefix, hook } as any), // eslint-disable-line
    warn: (message: string) =>
      hookLogger.warn({ message, prefix, hook } as any), // eslint-disable-line
  };
}
