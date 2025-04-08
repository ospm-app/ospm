import path from 'node:path';
import {
  normalizeRegistries,
  DEFAULT_REGISTRIES,
} from '../../normalize-registries/index.ts';
import type { LockFileDir, Registries } from '../../types/index.ts';
import type { ReporterFunction } from '../types.ts';

export type StrictStoreStatusOptions = {
  autoInstallPeers: boolean;
  excludeLinksFromLockfile: boolean;
  lockfileDir: LockFileDir;
  dir: string;
  storeDir: string;
  force: boolean;
  nodeLinker: 'isolated' | 'hoisted' | 'pnp';
  useLockfile: boolean;
  registries: Registries;
  shamefullyHoist: boolean;

  reporter?: ReporterFunction | undefined;
  production: boolean;
  development: boolean;
  optional: boolean;
  binsDir: string;
  virtualStoreDirMaxLength: number;
  peersSuffixMaxLength: number;
};

export type StoreStatusOptions = Partial<StrictStoreStatusOptions> &
  Pick<StrictStoreStatusOptions, 'storeDir' | 'virtualStoreDirMaxLength'>;

const defaults = async (
  opts: StoreStatusOptions
): Promise<StrictStoreStatusOptions> => {
  const dir = opts.dir ?? process.cwd();

  const lockfileDir = opts.lockfileDir ?? dir;

  return {
    binsDir: path.join(dir, 'node_modules', '.bin'),
    dir,
    force: false,
    lockfileDir,
    nodeLinker: 'isolated',
    registries: DEFAULT_REGISTRIES,
    shamefullyHoist: false,
    storeDir: opts.storeDir,
    useLockfile: true,
  } as StrictStoreStatusOptions;
};

export async function extendStoreStatusOptions(
  opts: StoreStatusOptions
): Promise<StrictStoreStatusOptions> {
  for (const key in opts) {
    if (opts[key as keyof StoreStatusOptions] === undefined) {
      delete opts[key as keyof StoreStatusOptions];
    }
  }

  const defaultOpts = await defaults(opts);

  const extendedOpts = {
    ...defaultOpts,
    ...opts,
    storeDir: defaultOpts.storeDir,
  };

  extendedOpts.registries = normalizeRegistries(extendedOpts.registries);

  return extendedOpts;
}
