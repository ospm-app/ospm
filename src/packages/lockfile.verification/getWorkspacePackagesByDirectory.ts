import type { WorkspacePackages } from '../resolver-base/index.ts';
import type { DependencyManifest } from '../types/index.ts';

export function getWorkspacePackagesByDirectory(
  workspacePackages: WorkspacePackages
): Record<string, DependencyManifest> {
  const workspacePackagesByDirectory: Record<string, DependencyManifest> = {};

  if (typeof workspacePackages !== 'undefined') {
    for (const pkgVersions of workspacePackages.values()) {
      for (const { rootDir, manifest } of pkgVersions.values()) {
        workspacePackagesByDirectory[rootDir] = manifest;
      }
    }
  }

  return workspacePackagesByDirectory;
}
