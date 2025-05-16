import {
  installCheckLogger,
  skippedOptionalDependencyLogger,
} from '../core-loggers/index.ts';
import { getSystemNodeVersion } from '../env.system-node-version/index.ts';
import {
  checkEngine,
  UnsupportedEngineError,
  type WantedEngine,
} from './checkEngine.ts';
import { checkPlatform, UnsupportedPlatformError } from './checkPlatform.ts';
import type { SupportedArchitectures } from '../types/index.ts';

export type { Engine } from './checkEngine.ts';
export type { Platform, WantedPlatform } from './checkPlatform.ts';

export { UnsupportedEngineError, UnsupportedPlatformError, type WantedEngine };

export async function packageIsInstallable(
  pkgId: string,
  pkg: {
    name: string;
    version: string;
    engines?: WantedEngine | undefined;
    cpu?: string[] | undefined;
    os?: string[] | undefined;
    libc?: string[] | undefined;
  },
  options: {
    engineStrict?: boolean | undefined;
    nodeVersion?: string | undefined;
    optional: boolean;
    ospmVersion?: string | undefined;
    lockfileDir: string;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<boolean> {
  const warn = await checkPackage(pkgId, pkg, options);

  if (warn == null) {
    return true;
  }

  installCheckLogger.warn({
    message: warn.message,
    prefix: options.lockfileDir,
  });

  if (options.optional) {
    skippedOptionalDependencyLogger.debug({
      details: warn.toString(),
      package: {
        id: pkgId,
        name: pkg.name,
        version: pkg.version,
      },
      prefix: options.lockfileDir,
      reason:
        warn.code === 'ERR_OSPM_UNSUPPORTED_ENGINE'
          ? 'unsupported_engine'
          : 'unsupported_platform',
    });

    return false;
  }

  if (options.engineStrict === true) {
    throw warn;
  }

  return false;
}

export async function checkPackage(
  pkgId: string,
  manifest: {
    engines?: WantedEngine | undefined;
    cpu?: string[] | undefined;
    os?: string[] | undefined;
    libc?: string[] | undefined;
  },
  options: {
    nodeVersion?: string | undefined;
    ospmVersion?: string | undefined;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<null | UnsupportedEngineError | UnsupportedPlatformError> {
  return (
    checkPlatform(
      pkgId,
      {
        cpu: manifest.cpu ?? ['any'],
        os: manifest.os ?? ['any'],
        libc: manifest.libc ?? ['any'],
      },
      options.supportedArchitectures
    ) ??
    (manifest.engines == null
      ? null
      : checkEngine(pkgId, manifest.engines, {
          node:
            options.nodeVersion ??
            (await getSystemNodeVersion()) ??
            process.version,
          ospm: options.ospmVersion,
        }))
  );
}
