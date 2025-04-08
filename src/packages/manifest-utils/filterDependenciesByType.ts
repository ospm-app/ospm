import type {
  Dependencies,
  IncludedDependencies,
  ProjectManifest,
} from '../types/index.ts';

export function filterDependenciesByType(
  manifest: ProjectManifest,
  include: IncludedDependencies
): Dependencies {
  return {
    ...(include.dependencies ? manifest.dependencies : {}),
    ...(include.devDependencies ? manifest.devDependencies : {}),
    ...(include.optionalDependencies ? manifest.optionalDependencies : {}),
  };
}
