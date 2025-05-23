import type {
  CatalogResolutionUnused,
  CatalogResolutionResult,
  CatalogResolutionFound,
  CatalogResolutionMisconfiguration,
} from './resolveFromCatalog.ts';

export type CatalogResultMatcher<T> = {
  readonly found: (found: CatalogResolutionFound) => T;
  readonly misconfiguration: (
    misconfiguration: CatalogResolutionMisconfiguration
  ) => T;
  readonly unused: (unused: CatalogResolutionUnused) => T;
};

export function matchCatalogResolveResult<T>(
  result: CatalogResolutionResult,
  matcher: CatalogResultMatcher<T>
): T {
  switch (result.type) {
    case 'found': {
      return matcher.found(result);
    }
    case 'misconfiguration': {
      return matcher.misconfiguration(result);
    }
    case 'unused': {
      return matcher.unused(result);
    }
  }
}
