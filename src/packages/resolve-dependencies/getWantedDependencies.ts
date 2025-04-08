import { filterDependenciesByType } from '../manifest-utils/index.ts';
import type {
  Dependencies,
  DependenciesMeta,
  IncludedDependencies,
  ProjectManifest,
} from '../types/index.ts';
import { whichVersionIsPinned } from '../which-version-is-pinned/index.ts';
import { WorkspaceSpec } from '../workspace.spec-parser/index.ts';

export type PinnedVersion = 'major' | 'minor' | 'patch' | 'none';

export type WantedDependency = {
  alias?: string | undefined;
  pref?: string | undefined; // package reference
  dev?: boolean | undefined;
  optional?: boolean | undefined;
  raw?: string | undefined;
  pinnedVersion?: PinnedVersion | undefined;
  nodeExecPath?: string | undefined;
  updateSpec?: boolean | undefined;
};

export function getWantedDependencies(
  pkg: ProjectManifest,
  opts?:
    | {
        autoInstallPeers?: boolean | undefined;
        includeDirect?: IncludedDependencies | undefined;
        nodeExecPath?: string | undefined;
        updateWorkspaceDependencies?: boolean | undefined;
      }
    | undefined
): WantedDependency[] {
  let depsToInstall = filterDependenciesByType(
    pkg,
    opts?.includeDirect ?? {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    }
  );

  if (opts?.autoInstallPeers === true) {
    depsToInstall = {
      ...pkg.peerDependencies,
      ...depsToInstall,
    };
  }

  return getWantedDependenciesFromGivenSet(depsToInstall, {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
    dependenciesMeta: pkg.dependenciesMeta ?? {},
    peerDependencies: pkg.peerDependencies ?? {},
    updatePref:
      opts?.updateWorkspaceDependencies === true
        ? updateWorkspacePref
        : (pref) => pref,
  });
}

function updateWorkspacePref(pref: string): string {
  const spec = WorkspaceSpec.parse(pref);

  if (!spec) {
    return pref;
  }

  spec.version = '*';

  return spec.toString();
}

function getWantedDependenciesFromGivenSet(
  deps: Dependencies,
  opts: {
    dependencies: Dependencies;
    devDependencies: Dependencies;
    optionalDependencies: Dependencies;
    peerDependencies: Dependencies;
    dependenciesMeta: DependenciesMeta;
    nodeExecPath?: string;
    updatePref: (pref: string) => string;
  }
): WantedDependency[] {
  if (typeof deps === 'undefined') {
    return [];
  }

  return Object.entries(deps).map(
    ([alias, pref]: [string, string]): WantedDependency & {
      injected: boolean;
    } => {
      const updatedPref = opts.updatePref(pref);

      let depType: 'optional' | 'prod' | 'dev' | undefined;

      if (opts.optionalDependencies[alias] != null) {
        depType = 'optional';
      } else if (opts.dependencies[alias] != null) {
        depType = 'prod';
      } else if (opts.devDependencies[alias] != null) {
        depType = 'dev';
      } else if (opts.peerDependencies[alias] != null) {
        depType = 'prod';
      }

      return {
        alias,
        dev: depType === 'dev',
        injected: opts.dependenciesMeta[alias]?.injected ?? false,
        optional: depType === 'optional',
        nodeExecPath: opts.nodeExecPath ?? opts.dependenciesMeta[alias]?.node,
        pinnedVersion: whichVersionIsPinned(pref),
        pref: updatedPref,
        raw: `${alias}@${pref}`,
      };
    }
  );
}
