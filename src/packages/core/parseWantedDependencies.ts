import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';
import type { Dependencies } from '../types/index.ts';
import {
  whichVersionIsPinned,
  type PinnedVersion,
} from '../which-version-is-pinned/index.ts';
import type { Catalog } from '../catalogs.types/index.ts';
import type { WantedDependency } from '../resolve-dependencies/getWantedDependencies.ts';

export function parseWantedDependencies(
  rawWantedDependencies: string[],
  opts: {
    allowNew: boolean;
    currentPrefs: Dependencies;
    defaultTag: string;
    dev: boolean;
    devDependencies: Dependencies;
    optional: boolean;
    optionalDependencies: Dependencies;
    overrides?: Record<string, string> | undefined;
    updateWorkspaceDependencies?: boolean | undefined;
    preferredSpecs?: Record<string, string> | undefined;
    defaultCatalog?: Catalog | undefined;
  }
): WantedDependency[] {
  return rawWantedDependencies
    .map((rawWantedDependency: string): WantedDependency | null => {
      const parsed = parseWantedDependency(rawWantedDependency);

      const alias = parsed.alias;

      let pref = parsed.pref;

      let pinnedVersion: PinnedVersion | undefined;

      if (
        typeof alias === 'undefined' ||
        (!opts.allowNew && typeof opts.currentPrefs[alias] === 'undefined')
      ) {
        return null;
      }

      if (
        typeof alias !== 'undefined' &&
        typeof opts.defaultCatalog?.[alias] !== 'undefined' &&
        ((typeof opts.currentPrefs[alias] === 'undefined' &&
          typeof pref === 'undefined') ||
          opts.defaultCatalog[alias] === pref ||
          opts.defaultCatalog[alias] === opts.currentPrefs[alias])
      ) {
        pref = 'catalog:';
      }

      if (
        typeof alias === 'string' &&
        typeof opts.currentPrefs[alias] === 'string'
      ) {
        if (typeof pref === 'undefined') {
          pref =
            opts.currentPrefs[alias].startsWith('workspace:') &&
            opts.updateWorkspaceDependencies === true
              ? 'workspace:*'
              : opts.currentPrefs[alias];
        }

        pinnedVersion = whichVersionIsPinned(opts.currentPrefs[alias]);
      }

      const result = {
        alias,
        dev: Boolean(
          opts.dev ||
            (typeof alias === 'string' &&
              typeof opts.devDependencies[alias] !== 'undefined')
        ),
        optional: Boolean(
          opts.optional ||
            (typeof alias === 'string' &&
              typeof opts.optionalDependencies[alias] !== 'undefined')
        ),
        pinnedVersion,
        raw:
          typeof alias === 'string' &&
          typeof opts.currentPrefs[alias] === 'string' &&
          opts.currentPrefs[alias].startsWith('workspace:')
            ? `${alias}@${opts.currentPrefs[alias]}`
            : rawWantedDependency,
      };

      if (typeof pref === 'string') {
        return {
          ...result,
          pref,
        };
      }

      if (typeof opts.preferredSpecs?.[alias] === 'string') {
        return {
          ...result,
          pref: opts.preferredSpecs[alias],
          raw: `${rawWantedDependency}@${opts.preferredSpecs[alias]}`,
        };
      }

      if (typeof opts.overrides?.[alias] === 'string') {
        return {
          ...result,
          pref: opts.overrides[alias],
          raw: `${alias}@${opts.overrides[alias]}`,
        };
      }

      return {
        ...result,
        pref: opts.defaultTag,
      };
    })
    .filter(Boolean);
}
