import assert from 'node:assert';
import fs from 'node:fs';
import util from 'node:util';
import { OspmError } from '../error/index.ts';
import { logger } from '../logger/index.ts';
import type { PackageManifest } from '../types/index.ts';
import chalk from 'chalk';
import type { Hooks } from './Hooks.ts';
import process from 'node:process';

export class BadReadPackageHookError extends OspmError {
  readonly ospmfile: string;

  constructor(ospmfile: string, message: string) {
    super(
      'BAD_READ_PACKAGE_HOOK_RESULT',
      `${message} Hook imported via ${ospmfile}`
    );

    this.ospmfile = ospmfile;
  }
}

class OspmFileFailError extends OspmError {
  readonly ospmfile: string;
  readonly originalError: Error;

  constructor(ospmfile: string, originalError: Error) {
    super(
      'OSPMFILE_FAIL',
      `Error during ospmfile execution. ospmfile: "${ospmfile}". Error: "${originalError.message}".`
    );
    this.ospmfile = ospmfile;
    this.originalError = originalError;
  }
}

export type Ospmfile = {
  hooks?: Hooks | undefined;
  filename: string;
};

export function requireOspmfile(
  ospmFilePath: string,
  prefix: string
): Ospmfile | undefined {
  try {
    const ospmfile: {
      hooks?: { readPackage?: unknown | undefined } | undefined;
      filename?: unknown | undefined;
    } = require(ospmFilePath); // eslint-disable-line

    if (typeof ospmfile === 'undefined') {
      logger.warn({
        message: `Ignoring the ospmfile at "${ospmFilePath}". It exports "undefined".`,
        prefix,
      });

      return undefined;
    }

    if (
      typeof ospmfile.hooks?.readPackage !== 'undefined' &&
      typeof ospmfile.hooks.readPackage !== 'function'
    ) {
      throw new TypeError('hooks.readPackage should be a function');
    }

    if (typeof ospmfile.hooks?.readPackage === 'function') {
      const readPackage = ospmfile.hooks.readPackage;

      ospmfile.hooks.readPackage = async (
        pkg: PackageManifest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...args: any[]
      ) => {
        pkg.dependencies = pkg.dependencies ?? {};
        pkg.devDependencies = pkg.devDependencies ?? {};
        pkg.optionalDependencies = pkg.optionalDependencies ?? {};
        pkg.peerDependencies = pkg.peerDependencies ?? {};
        const newPkg = await readPackage(pkg, ...args);

        // TODO: valibot schema
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!newPkg) {
          throw new BadReadPackageHookError(
            ospmFilePath,
            'readPackage hook did not return a package manifest object.'
          );
        }

        const dependencies = [
          'dependencies',
          'optionalDependencies',
          'peerDependencies',
        ];

        for (const dep of dependencies) {
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (newPkg[dep] && typeof newPkg[dep] !== 'object') {
            throw new BadReadPackageHookError(
              ospmFilePath,
              `readPackage hook returned package manifest object's property '${dep}' must be an object.`
            );
          }
        }

        return newPkg;
      };
    }

    ospmfile.filename = ospmFilePath;

    return ospmfile as Ospmfile;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      console.error(chalk.red('A syntax error in the .ospmfile.cjs\n'));
      console.error(err);

      // eslint-disable-next-line n/no-process-exit
      process.exit(1);
    }
    assert(util.types.isNativeError(err));
    if (
      !('code' in err && err.code === 'MODULE_NOT_FOUND') ||
      ospmFileExistsSync(ospmFilePath)
    ) {
      throw new OspmFileFailError(ospmFilePath, err);
    }
    return undefined;
  }
}

function ospmFileExistsSync(ospmFilePath: string): boolean {
  return fs.existsSync(
    ospmFilePath.endsWith('.cjs') ? ospmFilePath : `${ospmFilePath}.cjs`
  );
}
