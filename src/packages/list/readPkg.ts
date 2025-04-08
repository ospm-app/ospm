import { readPackageJson } from '../read-package-json/index.ts';
import type { PackageManifest } from '../types/index.ts';
import pLimit from 'p-limit';

const limitPkgReads = pLimit(4);

export async function readPkg(pkgPath: string): Promise<PackageManifest> {
  return limitPkgReads(async () => readPackageJson(pkgPath));
}
