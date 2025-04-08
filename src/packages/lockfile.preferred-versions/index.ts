import type { PackageSnapshots } from '../lockfile.types/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import {
  type PreferredVersions,
  DIRECT_DEP_SELECTOR_WEIGHT,
} from '../resolver-base/index.ts';
import type { DependencyManifest, ProjectManifest } from '../types/index.ts';
import getVersionSelectorType from 'version-selector-type';

export function getPreferredVersionsFromLockfileAndManifests(
  snapshots: PackageSnapshots | undefined,
  manifests: Array<DependencyManifest | ProjectManifest>
): PreferredVersions {
  const preferredVersions: PreferredVersions = {};

  for (const manifest of manifests) {
    const specs = getAllDependenciesFromManifest(manifest);

    for (const [name, spec] of Object.entries(specs)) {
      const selector = getVersionSelectorType(spec);

      if (!selector) continue;

      preferredVersions[name] = preferredVersions[name] ?? {};

      preferredVersions[name][spec] = {
        selectorType: selector.type,
        weight: DIRECT_DEP_SELECTOR_WEIGHT,
      };
    }
  }

  if (typeof snapshots === 'undefined') {
    return preferredVersions;
  }

  addPreferredVersionsFromLockfile(snapshots, preferredVersions);

  return preferredVersions;
}

function addPreferredVersionsFromLockfile(
  snapshots: PackageSnapshots,
  preferredVersions: PreferredVersions
): void {
  for (const [depPath, snapshot] of Object.entries(snapshots)) {
    const { name, version } = nameVerFromPkgSnapshot(depPath, snapshot);

    const v = preferredVersions[name];

    if (typeof v === 'undefined') {
      preferredVersions[name] = { [version]: 'version' };
    } else if (typeof v[version] === 'undefined') {
      v[version] = 'version';
    }
  }
}
