import type { ProjectSnapshot } from '../lockfile.types/index.ts';
import type { DependenciesField } from '../types/index.ts';

export function filterImporter(
  importer: ProjectSnapshot,
  include: { [dependenciesField in DependenciesField]: boolean }
): ProjectSnapshot {
  return {
    dependencies: include.dependencies ? (importer.dependencies ?? {}) : {},
    devDependencies: include.devDependencies
      ? (importer.devDependencies ?? {})
      : {},
    optionalDependencies: include.optionalDependencies
      ? (importer.optionalDependencies ?? {})
      : {},
    specifiers: importer.specifiers,
  };
}
