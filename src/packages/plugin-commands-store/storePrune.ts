import { streamParser } from '../logger/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import type { ReporterFunction } from './types.ts';
import { cleanExpiredDlxCache } from './cleanExpiredDlxCache.ts';

export async function storePrune(opts: {
  reporter?: ReporterFunction | undefined;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    { isBuilt: boolean; importMethod?: string | undefined }
  >;
  removeAlienFiles?: boolean | undefined;
  cacheDir: string;
  dlxCacheMaxAge: number;
}): Promise<void> {
  const reporter = opts.reporter;

  if (typeof reporter !== 'undefined' && typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  await opts.storeController.prune(opts.removeAlienFiles);

  await opts.storeController.close();

  await cleanExpiredDlxCache({
    cacheDir: opts.cacheDir,
    dlxCacheMaxAge: opts.dlxCacheMaxAge,
    now: new Date(),
  });

  if (reporter != null && typeof reporter === 'function') {
    streamParser.removeListener('data', reporter);
  }
}
