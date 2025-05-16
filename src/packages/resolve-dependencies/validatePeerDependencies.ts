import { OspmError } from '../error/index.ts';
import type { ProjectManifest } from '../types/index.ts';
import { isValidPeerRange } from '../semver.peer-range/index.ts';

export type ProjectToValidate = {
  rootDir: string;
  manifest?: Pick<ProjectManifest, 'name' | 'peerDependencies'> | undefined;
};

export function validatePeerDependencies(project: ProjectToValidate): void {
  if (typeof project.manifest === 'undefined') {
    return;
  }

  const { name, peerDependencies } = project.manifest;

  const projectId = name || project.rootDir;

  for (const depName in peerDependencies) {
    const version = peerDependencies[depName];

    if (typeof version !== 'string' || !isValidPeerRange(version)) {
      throw new OspmError(
        'INVALID_PEER_DEPENDENCY_SPECIFICATION',
        `The peerDependencies field named '${depName}' of package '${projectId}' has an invalid value: '${version}'`,
        {
          hint: 'The values in peerDependencies should be either a valid semver range, a `workspace:` spec, or a `catalog:` spec',
        }
      );
    }
  }
}
