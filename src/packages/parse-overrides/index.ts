import { OspmError } from '../error/index.ts';
import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';
import {
  matchCatalogResolveResult,
  resolveFromCatalog,
  type CatalogResolutionFound,
  type CatalogResolutionMisconfiguration,
} from '../catalogs.resolver/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';

// eslint-disable-next-line optimize-regex/optimize-regex
const DELIMITER_REGEX = /[^ |@]>/;

export type VersionOverride = {
  selector?: string | undefined;
  parentPkg: PackageSelector;
  targetPkg: PackageSelector;
  newPref: string;
};

export type PackageSelector = {
  name: string;
  pref?: string | undefined;
};

export function parseOverrides(
  overrides: Record<string, string>,
  catalogs?: Catalogs | undefined
): Array<
  | {
      parentPkg: PackageSelector;
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
  | {
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
> {
  const _resolveFromCatalog = resolveFromCatalog.bind(null, catalogs ?? {});

  return Object.entries(overrides).map(
    ([selector, newPref]: [string, string]):
      | {
          parentPkg: PackageSelector;
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        }
      | {
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        } => {
      const result = parsePkgAndParentSelector(selector);

      const resolvedCatalog = matchCatalogResolveResult(
        _resolveFromCatalog({
          pref: newPref,
          alias: result.targetPkg.name,
        }),
        {
          found: ({ resolution }: CatalogResolutionFound): string => {
            return resolution.specifier;
          },
          unused: () => {
            return undefined;
          },
          misconfiguration: ({
            error,
          }: CatalogResolutionMisconfiguration): never => {
            throw new OspmError(
              'CATALOG_IN_OVERRIDES',
              `Could not resolve a catalog in the overrides: ${error.message}`
            );
          },
        }
      );

      return {
        selector,
        newPref: resolvedCatalog ?? newPref,
        ...result,
      };
    }
  );
}

export function parsePkgAndParentSelector(selector: string):
  | {
      parentPkg: PackageSelector;
      targetPkg: PackageSelector;
    }
  | {
      targetPkg: PackageSelector;
    } {
  let delimiterIndex = selector.search(DELIMITER_REGEX);

  if (delimiterIndex !== -1) {
    delimiterIndex++;

    const parentSelector = selector.substring(0, delimiterIndex);

    const childSelector = selector.substring(delimiterIndex + 1);

    return {
      parentPkg: parsePkgSelector(parentSelector),
      targetPkg: parsePkgSelector(childSelector),
    };
  }

  return {
    targetPkg: parsePkgSelector(selector),
  };
}

function parsePkgSelector(selector: string): PackageSelector {
  const wantedDep = parseWantedDependency(selector);

  if (typeof wantedDep.alias === 'undefined') {
    throw new OspmError(
      'INVALID_SELECTOR',
      `Cannot parse the "${selector}" selector`
    );
  }

  return {
    name: wantedDep.alias,
    pref: wantedDep.pref,
  };
}
