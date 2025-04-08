import type { CatalogSnapshots } from '../lockfile.types/index.ts';
import type { ResolvedDirectDependency } from './resolveDependencyTree.ts';

export function getCatalogSnapshots(
  resolvedDirectDeps: readonly ResolvedDirectDependency[]
): CatalogSnapshots {
  const catalogSnapshots: CatalogSnapshots = {};
  const catalogedDeps = resolvedDirectDeps.filter(isCatalogedDep);

  for (const dep of catalogedDeps) {
    if (typeof dep.catalogLookup?.catalogName !== 'undefined') {
      let snapshotForSingleCatalog =
        catalogSnapshots[dep.catalogLookup.catalogName];

      if (typeof snapshotForSingleCatalog === 'undefined') {
        snapshotForSingleCatalog = {};
        catalogSnapshots[dep.catalogLookup.catalogName] =
          snapshotForSingleCatalog;
      }

      snapshotForSingleCatalog[dep.alias] = {
        specifier: dep.catalogLookup.specifier,
        version: dep.version,
      };
    }
  }

  return catalogSnapshots;
}

function isCatalogedDep(
  dep: ResolvedDirectDependency
): dep is ResolvedDirectDependency & {
  catalogLookup: Required<ResolvedDirectDependency>['catalogLookup'];
} {
  return dep.catalogLookup != null;
}
