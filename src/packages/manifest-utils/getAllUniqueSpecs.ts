import type { DependencyManifest } from '../types/index.ts';
import { getAllDependenciesFromManifest } from './getAllDependenciesFromManifest.ts';

export function getAllUniqueSpecs(
  manifests: DependencyManifest[]
): Record<string, string> {
  const allSpecs: Record<string, string> = {};

  const ignored = new Set<string>();

  for (const manifest of manifests) {
    const specs = getAllDependenciesFromManifest(manifest);

    for (const [name, spec] of Object.entries(specs)) {
      if (ignored.has(name) || typeof spec !== 'string') {
        continue;
      }

      if (
        (allSpecs[name] != null && allSpecs[name] !== spec) ||
        spec.includes(':') === true
      ) {
        ignored.add(name);
        delete allSpecs[name];
        continue;
      }

      allSpecs[name] = spec;
    }
  }
  return allSpecs;
}
