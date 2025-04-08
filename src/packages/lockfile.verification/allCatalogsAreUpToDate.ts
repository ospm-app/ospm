import type {
  CatalogSnapshots,
  ResolvedCatalogEntry,
} from '../lockfile.types/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';

export function allCatalogsAreUpToDate(
  catalogsConfig: Catalogs,
  snapshot: CatalogSnapshots | undefined
): boolean {
  return Object.entries(snapshot ?? {}).every(
    ([catalogName, catalog]: [
      string,
      {
        [dependencyName: string]: ResolvedCatalogEntry;
      },
    ]): boolean => {
      return Object.entries(catalog).every(([alias, entry]): boolean => {
        return entry.specifier === catalogsConfig[catalogName]?.[alias];
      });
    }
  );
}
