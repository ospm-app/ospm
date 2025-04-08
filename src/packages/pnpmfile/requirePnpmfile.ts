import assert from 'node:assert';
import fs from 'node:fs';
import util from 'node:util';
import { PnpmError } from '../error/index.ts';
import { logger } from '../logger/index.ts';
import type { PackageManifest } from '../types/index.ts';
import chalk from 'chalk';
import type { Hooks } from './Hooks.ts';
import process from 'node:process';

export class BadReadPackageHookError extends PnpmError {
  readonly pnpmfile: string;

  constructor(pnpmfile: string, message: string) {
    super(
      'BAD_READ_PACKAGE_HOOK_RESULT',
      `${message} Hook imported via ${pnpmfile}`
    );
    this.pnpmfile = pnpmfile;
  }
}

class PnpmFileFailError extends PnpmError {
  readonly pnpmfile: string;
  readonly originalError: Error;

  constructor(pnpmfile: string, originalError: Error) {
    super(
      'PNPMFILE_FAIL',
      `Error during pnpmfile execution. pnpmfile: "${pnpmfile}". Error: "${originalError.message}".`
    );
    this.pnpmfile = pnpmfile;
    this.originalError = originalError;
  }
}

export type Pnpmfile = {
  hooks?: Hooks | undefined;
  filename: string;
};

export function requirePnpmfile(
  pnpmFilePath: string,
  prefix: string
): Pnpmfile | undefined {
  try {
    const pnpmfile: {
      hooks?: { readPackage?: unknown | undefined } | undefined;
      filename?: unknown | undefined;
    } = require(pnpmFilePath); // eslint-disable-line
    if (typeof pnpmfile === 'undefined') {
      logger.warn({
        message: `Ignoring the pnpmfile at "${pnpmFilePath}". It exports "undefined".`,
        prefix,
      });

      return undefined;
    }

    if (
      typeof pnpmfile.hooks?.readPackage !== 'undefined' &&
      typeof pnpmfile.hooks.readPackage !== 'function'
    ) {
      throw new TypeError('hooks.readPackage should be a function');
    }

    if (typeof pnpmfile.hooks?.readPackage === 'function') {
      const readPackage = pnpmfile.hooks.readPackage;

      pnpmfile.hooks.readPackage = async (
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
            pnpmFilePath,
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
              pnpmFilePath,
              `readPackage hook returned package manifest object's property '${dep}' must be an object.`
            );
          }
        }

        return newPkg;
      };
    }

    pnpmfile.filename = pnpmFilePath;

    return pnpmfile as Pnpmfile;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      console.error(chalk.red('A syntax error in the .pnpmfile.cjs\n'));
      console.error(err);

      // eslint-disable-next-line n/no-process-exit
      process.exit(1);
    }
    assert(util.types.isNativeError(err));
    if (
      !('code' in err && err.code === 'MODULE_NOT_FOUND') ||
      pnpmFileExistsSync(pnpmFilePath)
    ) {
      throw new PnpmFileFailError(pnpmFilePath, err);
    }
    return undefined;
  }
}

function pnpmFileExistsSync(pnpmFilePath: string): boolean {
  const pnpmFileRealName = pnpmFilePath.endsWith('.cjs')
    ? pnpmFilePath
    : `${pnpmFilePath}.cjs`;
  return fs.existsSync(pnpmFileRealName);
}
