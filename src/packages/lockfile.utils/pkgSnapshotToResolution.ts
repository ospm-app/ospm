import url from 'node:url';
import type { PackageSnapshot } from '../lockfile.types/index.ts';
import type { Resolution } from '../resolver-base/index.ts';
import type { Registries } from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import getNpmTarballUrl from 'get-npm-tarball-url';
import { isGitHostedPkgUrl } from '../pick-fetcher/index.ts';
import { nameVerFromPkgSnapshot } from './nameVerFromPkgSnapshot.ts';

export function pkgSnapshotToResolution(
  depPath: string,
  pkgSnapshot: PackageSnapshot,
  registries: Registries
): Resolution | undefined {
  if (
    typeof pkgSnapshot.resolution !== 'undefined' &&
    ('type' in pkgSnapshot.resolution ||
      pkgSnapshot.resolution.tarball?.startsWith('file:') === true ||
      isGitHostedPkgUrl(pkgSnapshot.resolution.tarball))
  ) {
    return pkgSnapshot.resolution;
  }

  const { name } = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

  let registry =
    name !== '' && name.startsWith('@')
      ? (registries[name.split('/')[0] ?? ''] ?? '')
      : '';

  if (!registry) {
    registry = registries.default;
  }

  const tarball =
    typeof pkgSnapshot.resolution?.tarball === 'undefined' ||
    pkgSnapshot.resolution.tarball === ''
      ? getTarball(registry, depPath)
      : new url.URL(
          pkgSnapshot.resolution.tarball,
          registry.endsWith('/') ? registry : `${registry}/`
        ).toString();

  return {
    ...pkgSnapshot.resolution,
    tarball,
  };
}

function getTarball(registry: string, depPath: string): string {
  const { name, version } = dp.parse(depPath);

  if (typeof name === 'undefined' || typeof version === 'undefined') {
    throw new Error(`Couldn't get tarball URL from dependency path ${depPath}`);
  }

  return getNpmTarballUrl(name, version, { registry });
}
