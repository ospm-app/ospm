import type {
  Dependencies,
  ProjectManifest,
  DependenciesField,
} from '../types/index.ts';

export function getAllDependenciesFromManifest(
  pkg: Pick<ProjectManifest, DependenciesField>
): Dependencies {
  return {
    ...pkg.devDependencies,
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  };
}
