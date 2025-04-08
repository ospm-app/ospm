import type {
  ProjectManifest,
  DependenciesOrPeersField,
} from '../types/index.ts';

export function getSpecFromPackageManifest(
  manifest: Pick<ProjectManifest, DependenciesOrPeersField>,
  depName: string
): string {
  return (
    manifest.optionalDependencies?.[depName] ??
    manifest.dependencies?.[depName] ??
    manifest.devDependencies?.[depName] ??
    manifest.peerDependencies?.[depName] ??
    ''
  );
}
