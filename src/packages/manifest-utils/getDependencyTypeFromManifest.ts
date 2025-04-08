import type {
  ProjectManifest,
  DependenciesOrPeersField,
} from '../types/index.ts';

export function getDependencyTypeFromManifest(
  manifest: Pick<ProjectManifest, DependenciesOrPeersField>,
  depName: string
): DependenciesOrPeersField | null {
  if (typeof manifest.optionalDependencies?.[depName] === 'string') {
    return 'optionalDependencies';
  }

  if (typeof manifest.dependencies?.[depName] === 'string') {
    return 'dependencies';
  }

  if (typeof manifest.devDependencies?.[depName] === 'string') {
    return 'devDependencies';
  }

  if (typeof manifest.peerDependencies?.[depName] === 'string') {
    return 'peerDependencies';
  }

  return null;
}
