import type { PackageSnapshot } from '../lockfile.types/index.ts';
import { parse } from '../dependency-path/index.ts';
import type { PkgResolutionId } from '../types/index.ts';

export type NameVer = {
  name: string;
  peersSuffix: string;
  version: string;
  nonSemverVersion?: PkgResolutionId | undefined;
};

export function nameVerFromPkgSnapshot(
  depPath: string,
  pkgSnapshot?: PackageSnapshot | undefined
): NameVer {
  const pkgInfo = parse(depPath);

  return {
    name: pkgInfo.name as string,
    peersSuffix: pkgInfo.peersSuffix ?? '',
    version: pkgSnapshot?.version ?? pkgInfo.version ?? '',
    nonSemverVersion: pkgInfo.nonSemverVersion,
  };
}
