import type {
  Dependencies,
  IncludedDependencies,
  ProjectManifest,
} from '../types/index.ts';
import { getAllUniqueSpecs } from './getAllUniqueSpecs.ts';
import { getSpecFromPackageManifest } from './getSpecFromPackageManifest.ts';

export * from './getPref.ts';
export * from './updateProjectManifestObject.ts';
export * from './getDependencyTypeFromManifest.ts';

export { getSpecFromPackageManifest, getAllUniqueSpecs };

export function filterDependenciesByType(
  manifest?: ProjectManifest | undefined,
  include?: IncludedDependencies | undefined
): Dependencies {
  return {
    ...(include?.devDependencies === true ? manifest?.devDependencies : {}),
    ...(include?.dependencies === true ? manifest?.dependencies : {}),
    ...(include?.optionalDependencies === true
      ? manifest?.optionalDependencies
      : {}),
  };
}

export function getAllDependenciesFromManifest(
  manifest?:
    | Pick<
        ProjectManifest,
        'devDependencies' | 'dependencies' | 'optionalDependencies'
      >
    | undefined
): Dependencies {
  return {
    ...manifest?.devDependencies,
    ...manifest?.dependencies,
    ...manifest?.optionalDependencies,
  };
}
