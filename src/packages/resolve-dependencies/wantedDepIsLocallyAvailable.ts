import { parsePref, type RegistryPackageSpec } from '../npm-resolver/index.ts';
import type {
  WorkspacePackages,
  WorkspacePackagesByVersion,
} from '../resolver-base/index.ts';
import semver from 'semver';
import type { WantedDependency } from './index.ts';

export function wantedDepIsLocallyAvailable(
  workspacePackages: WorkspacePackages,
  wantedDependency: WantedDependency,
  opts: {
    defaultTag: string;
    registry: string;
  }
): boolean {
  if (typeof wantedDependency.pref === 'undefined') {
    return false;
  }

  const spec = parsePref(
    wantedDependency.pref,
    wantedDependency.alias,
    opts.defaultTag || 'latest',
    opts.registry
  );

  if (spec == null) {
    return false;
  }

  const sn = workspacePackages.has(spec.name);

  if (!sn) {
    return false;
  }

  const versions = workspacePackages.get(spec.name);

  if (typeof versions === 'undefined') {
    return false;
  }

  return pickMatchingLocalVersionOrNull(versions, spec) !== null;
}

// TODO: move this function to separate package or import from @pnpm/npm-resolver
function pickMatchingLocalVersionOrNull(
  versions: WorkspacePackagesByVersion,
  spec: RegistryPackageSpec
): string | null {
  const localVersions = Object.keys(versions);

  switch (spec.type) {
    case 'tag': {
      return semver.maxSatisfying(localVersions, '*');
    }

    case 'version': {
      return versions.has(spec.fetchSpec) ? spec.fetchSpec : null;
    }

    case 'range': {
      return semver.maxSatisfying(localVersions, spec.fetchSpec, true);
    }

    default: {
      return null;
    }
  }
}
