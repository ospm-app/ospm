import type {
  BaseManifest,
  PackageManifest,
  ReadPackageHook,
} from '../types/index.ts';
import { createMatcher } from '../matcher/index.ts';

export function createOptionalDependenciesRemover(
  toBeRemoved: string[]
): ReadPackageHook {
  if (!toBeRemoved.length) {
    return <Manifest extends BaseManifest>(manifest: Manifest): Manifest => {
      return manifest;
    };
  }

  const shouldBeRemoved = createMatcher(toBeRemoved);

  return (manifest: PackageManifest): PackageManifest => {
    return removeOptionalDependencies(manifest, shouldBeRemoved);
  };
}

function removeOptionalDependencies<Manifest extends BaseManifest>(
  manifest: Manifest,
  shouldBeRemoved: (input: string) => boolean
): Manifest {
  for (const optionalDependency in manifest.optionalDependencies) {
    if (shouldBeRemoved(optionalDependency)) {
      delete manifest.optionalDependencies[optionalDependency];

      delete manifest.dependencies?.[optionalDependency];
    }
  }

  return manifest;
}
