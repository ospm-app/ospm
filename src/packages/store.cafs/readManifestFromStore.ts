import gfs from '../graceful-fs/index.ts';
import type { PackageManifest } from '../types/index.ts';
import type { PackageFilesIndex } from './checkPkgFilesIntegrity.ts';
import { getFilePathByModeInCafs } from './getFilePathInCafs.ts';
import { parseJsonBufferSync } from './parseJson.ts';

export function readManifestFromStore(
  storeDir: string,
  pkgIndex: PackageFilesIndex
): PackageManifest | undefined {
  const pkg = pkgIndex.files['package.json'];

  if (typeof pkg !== 'undefined') {
    const fileName = getFilePathByModeInCafs(storeDir, pkg.integrity, pkg.mode);

    // TODO: valibot schema
    return parseJsonBufferSync(gfs.readFileSync(fileName)) as PackageManifest;
  }

  return;
}
