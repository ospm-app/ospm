import { PnpmError } from '../error/index.ts';
import { logger, globalInfo, streamParser } from '../logger/index.ts';
import {
  parseWantedDependency,
  type ParseWantedDependencyResult,
} from '../parse-wanted-dependency/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import type {
  SupportedArchitectures,
  Registries,
  LockFileDir,
} from '../types/index.ts';
import type { ReporterFunction } from './types.ts';

export async function storeAdd(
  fuzzyDeps: string[],
  opts: {
    prefix?: LockFileDir | undefined;
    registries?: Registries | undefined;
    reporter?: ReporterFunction | undefined;
    storeController: StoreController<
      PackageResponse,
      PackageResponse,
      { isBuilt: boolean; importMethod?: string | undefined }
    >;
    tag?: string | undefined;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<void> {
  const reporter = opts.reporter;

  if (typeof reporter !== 'undefined' && typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const deps = fuzzyDeps.map((dep: string): ParseWantedDependencyResult => {
    return parseWantedDependency(dep);
  });

  let hasFailures = false;

  const prefix: LockFileDir = opts.prefix ?? (process.cwd() as LockFileDir);

  const registries = opts.registries ?? {
    default: 'https://registry.npmjs.org/',
  };

  await Promise.all(
    deps.map(async (dep: ParseWantedDependencyResult): Promise<void> => {
      try {
        const pkgResponse = await opts.storeController.requestPackage(dep, {
          downloadPriority: 1,
          lockfileDir: prefix,
          preferredVersions: {},
          projectDir: prefix,
          registry:
            typeof dep.alias === 'string'
              ? pickRegistryForPackage(registries, dep.alias)
              : registries.default,
          supportedArchitectures: opts.supportedArchitectures,
        });

        await pkgResponse.fetching?.();

        globalInfo(`+ ${pkgResponse.body?.id}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        hasFailures = true;

        logger('store').error(e);
      }
    })
  );

  if (reporter != null && typeof reporter === 'function') {
    streamParser.removeListener('data', reporter);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (hasFailures) {
    throw new PnpmError(
      'STORE_ADD_FAILURE',
      'Some packages have not been added correctly'
    );
  }
}
