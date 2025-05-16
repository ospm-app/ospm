import { packageManager } from '../cli-meta/index.ts';
import { logger } from '../logger/index.ts';
import {
  checkPackage,
  type WantedEngine,
  UnsupportedEngineError,
} from '../package-is-installable/index.ts';
import type { SupportedArchitectures } from '../types/index.ts';

export async function packageIsInstallable(
  pkgPath: string,
  pkg: {
    packageManager?: string | undefined;
    engines?: WantedEngine | undefined;
    cpu?: string[] | undefined;
    os?: string[] | undefined;
    libc?: string[] | undefined;
  },
  opts: {
    packageManagerStrict?: boolean | undefined;
    packageManagerStrictVersion?: boolean | undefined;
    engineStrict?: boolean | undefined;
    nodeVersion?: string | undefined;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<void> {
  const currentOspmVersion =
    packageManager.name === 'ospm' ? packageManager.version : undefined;

  const err = await checkPackage(pkgPath, pkg, {
    nodeVersion: opts.nodeVersion,
    ospmVersion: currentOspmVersion,
    supportedArchitectures: opts.supportedArchitectures ?? {
      os: ['current'],
      cpu: ['current'],
      libc: ['current'],
    },
  });

  if (err === null) {
    return;
  }

  if (
    err instanceof UnsupportedEngineError &&
    typeof err.wanted.ospm === 'string' &&
    opts.engineStrict === true
  ) {
    throw err;
  }

  logger.warn({
    message: `Unsupported ${
      err instanceof UnsupportedEngineError ? 'engine' : 'platform'
    }: wanted: ${JSON.stringify(err.wanted)} (current: ${JSON.stringify(err.current)})`,
    prefix: pkgPath,
  });
}
