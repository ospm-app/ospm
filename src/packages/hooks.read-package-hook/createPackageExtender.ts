import type {
  PackageManifest,
  PackageExtension,
  ReadPackageHook,
} from '../types/index.ts';
import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';
import semver from 'semver';

type PackageExtensionMatch = {
  packageExtension: PackageExtension;
  range?: string | undefined;
};

type ExtensionsByPkgName = Map<string, PackageExtensionMatch[]>;

export function createPackageExtender(
  packageExtensions: Record<string, PackageExtension>
): ReadPackageHook {
  const extensionsByPkgName: ExtensionsByPkgName = new Map();

  for (const selector in packageExtensions) {
    const packageExtension = packageExtensions[selector];

    if (typeof packageExtension === 'undefined') {
      continue;
    }

    const { alias, pref } = parseWantedDependency(selector);

    if (typeof alias === 'undefined') {
      continue;
    }

    if (extensionsByPkgName.has(alias) !== true) {
      extensionsByPkgName.set(alias, []);
    }

    extensionsByPkgName.get(alias)?.push({ packageExtension, range: pref });
  }

  return extendPkgHook.bind(null, extensionsByPkgName) as ReadPackageHook;
}

function extendPkgHook(
  extensionsByPkgName: ExtensionsByPkgName,
  manifest: PackageManifest
): PackageManifest {
  const extensions = extensionsByPkgName.get(manifest.name);

  if (extensions == null) {
    return manifest;
  }

  extendPkg(manifest, extensions);

  return manifest;
}

function extendPkg(
  manifest: PackageManifest,
  extensions: PackageExtensionMatch[]
): void {
  for (const { range, packageExtension } of extensions) {
    if (range != null && !semver.satisfies(manifest.version, range)) {
      continue;
    }

    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'peerDependenciesMeta',
    ] as const) {
      if (!packageExtension[field]) {
        continue;
      }

      manifest[field] = {
        ...packageExtension[field],
        ...manifest[field],
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
}
