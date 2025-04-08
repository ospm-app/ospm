import path from 'node:path';
import { PnpmError } from '../error/index.ts';
import type { PackageManifest } from '../types/index.ts';
import { loadJsonFile } from 'load-json-file';
import normalizePackageData from 'normalize-package-data';

export async function readPackageJson(
  pkgPath: string
): Promise<PackageManifest> {
  try {
    const manifest = await loadJsonFile<PackageManifest>(pkgPath);
    normalizePackageData(manifest);
    return manifest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (err.code) {
      throw err;
    }

    throw new PnpmError(
      'BAD_PACKAGE_JSON',
      `${pkgPath}: ${err.message as string}`
    );
  }
}

export async function readPackageJsonFromDir(
  pkgPath: string
): Promise<PackageManifest> {
  return readPackageJson(path.join(pkgPath, 'package.json'));
}

export async function safeReadPackageJson(
  pkgPath: string
): Promise<PackageManifest | null> {
  try {
    return await readPackageJson(pkgPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }

    return null;
  }
}

export async function safeReadPackageJsonFromDir(
  pkgPath: string
): Promise<PackageManifest | null> {
  return safeReadPackageJson(path.join(pkgPath, 'package.json'));
}
