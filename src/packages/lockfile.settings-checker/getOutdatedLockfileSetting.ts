import type { LockfileObject, PatchFile } from '../lockfile.types/index.ts';
import equals from 'ramda/src/equals';

export type ChangedField =
  | 'patchedDependencies'
  | 'overrides'
  | 'packageExtensionsChecksum'
  | 'ignoredOptionalDependencies'
  | 'settings.autoInstallPeers'
  | 'settings.excludeLinksFromLockfile'
  | 'settings.peersSuffixMaxLength'
  | 'settings.injectWorkspacePackages'
  | 'ospmfileChecksum';

export function getOutdatedLockfileSetting(
  lockfile: LockfileObject,
  {
    overrides,
    packageExtensionsChecksum,
    ignoredOptionalDependencies,
    patchedDependencies,
    autoInstallPeers,
    excludeLinksFromLockfile,
    peersSuffixMaxLength,
    ospmfileChecksum,
    injectWorkspacePackages,
  }: {
    overrides?: Record<string, string> | undefined;
    packageExtensionsChecksum?: string | undefined;
    patchedDependencies?: Record<string, PatchFile> | undefined | undefined;
    ignoredOptionalDependencies?: string[] | undefined;
    autoInstallPeers?: boolean | undefined;
    excludeLinksFromLockfile?: boolean | undefined;
    peersSuffixMaxLength?: number | undefined;
    ospmfileChecksum?: string | undefined;
    injectWorkspacePackages?: boolean | undefined;
  }
): ChangedField | null {
  if (!equals.default(lockfile.overrides ?? {}, overrides ?? {})) {
    return 'overrides';
  }

  if (lockfile.packageExtensionsChecksum !== packageExtensionsChecksum) {
    return 'packageExtensionsChecksum';
  }

  if (
    !equals.default(
      lockfile.ignoredOptionalDependencies?.sort() ?? [],
      ignoredOptionalDependencies?.sort() ?? []
    )
  ) {
    return 'ignoredOptionalDependencies';
  }

  if (
    !equals.default(
      lockfile.patchedDependencies ?? {},
      patchedDependencies ?? {}
    )
  ) {
    return 'patchedDependencies';
  }

  if (
    lockfile.settings?.autoInstallPeers != null &&
    lockfile.settings.autoInstallPeers !== autoInstallPeers
  ) {
    return 'settings.autoInstallPeers';
  }

  if (
    lockfile.settings?.excludeLinksFromLockfile != null &&
    lockfile.settings.excludeLinksFromLockfile !== excludeLinksFromLockfile
  ) {
    return 'settings.excludeLinksFromLockfile';
  }

  if (
    (lockfile.settings?.peersSuffixMaxLength != null &&
      lockfile.settings.peersSuffixMaxLength !== peersSuffixMaxLength) ||
    (lockfile.settings?.peersSuffixMaxLength == null &&
      peersSuffixMaxLength !== 1000)
  ) {
    return 'settings.peersSuffixMaxLength';
  }

  if (lockfile.ospmfileChecksum !== ospmfileChecksum) {
    return 'ospmfileChecksum';
  }

  if (
    Boolean(lockfile.settings?.injectWorkspacePackages) !==
    Boolean(injectWorkspacePackages)
  ) {
    return 'settings.injectWorkspacePackages';
  }

  return null;
}
