import { OspmError } from '../error/index.ts';
import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';
import type { WorkspacePackages } from '../resolver-base/index.ts';
import type { IncludedDependencies, ProjectManifest } from '../types/index.ts';

export function updateToWorkspacePackagesFromManifest(
  manifest: ProjectManifest,
  include: IncludedDependencies,
  workspacePackages: WorkspacePackages
): string[] {
  const allDeps = {
    ...(include.devDependencies ? manifest.devDependencies : {}),
    ...(include.dependencies ? manifest.dependencies : {}),
    ...(include.optionalDependencies ? manifest.optionalDependencies : {}),
  };

  return Object.keys(allDeps)
    .filter((depName) => workspacePackages.has(depName))
    .map((depName) => `${depName}@workspace:*`);
}

export function createWorkspaceSpecs(
  specs: string[],
  workspacePackages: WorkspacePackages
): string[] {
  return specs.map((spec) => {
    const parsed = parseWantedDependency(spec);

    if (typeof parsed.alias === 'undefined' || parsed.alias === '') {
      throw new OspmError(
        'NO_PKG_NAME_IN_SPEC',
        `Cannot update/install from workspace through "${spec}"`
      );
    }

    if (!workspacePackages.has(parsed.alias)) {
      throw new OspmError(
        'WORKSPACE_PACKAGE_NOT_FOUND',
        `"${parsed.alias}" not found in the workspace`
      );
    }

    if (typeof parsed.pref === 'undefined' || parsed.pref === '') {
      return `${parsed.alias}@workspace:>=0.0.0`;
    }

    if (parsed.pref.startsWith('workspace:')) {
      return spec;
    }

    return `${parsed.alias}@workspace:${parsed.pref}`;
  });
}
