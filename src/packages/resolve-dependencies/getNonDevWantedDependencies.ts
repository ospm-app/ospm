import type {
  Dependencies,
  DependencyManifest,
  DependenciesMeta,
} from '../types/index.ts';
import pickBy from 'ramda/src/pickBy';
import type { WantedDependency } from './getWantedDependencies.ts';

type GetNonDevWantedDependenciesManifest = Pick<
  DependencyManifest,
  | 'bundleDependencies'
  | 'bundledDependencies'
  | 'optionalDependencies'
  | 'dependencies'
  | 'dependenciesMeta'
>;

export function getNonDevWantedDependencies(
  pkg: GetNonDevWantedDependenciesManifest
): WantedDependency[] {
  let bd = pkg.bundledDependencies ?? pkg.bundleDependencies;

  if (bd === true) {
    bd = pkg.dependencies != null ? Object.keys(pkg.dependencies) : [];
  }

  const bundledDeps = new Set(Array.isArray(bd) ? bd : []);

  const filterDeps = getNotBundledDeps.bind(null, bundledDeps);

  return getWantedDependenciesFromGivenSet(
    filterDeps({ ...pkg.optionalDependencies, ...pkg.dependencies }),
    {
      dependenciesMeta: pkg.dependenciesMeta ?? {},
      devDependencies: {},
      optionalDependencies: pkg.optionalDependencies ?? {},
    }
  );
}

function getWantedDependenciesFromGivenSet(
  deps: Dependencies | undefined,
  opts: {
    devDependencies: Dependencies;
    optionalDependencies: Dependencies;
    dependenciesMeta: DependenciesMeta;
  }
): WantedDependency[] {
  if (!deps) {
    return [];
  }

  return Object.entries(deps).map(
    ([alias, pref]: [string, string]): WantedDependency & {
      injected: boolean | undefined;
    } => {
      return {
        alias,
        dev: typeof opts.devDependencies[alias] !== 'undefined',
        injected: opts.dependenciesMeta[alias]?.injected,
        optional: typeof opts.optionalDependencies[alias] !== 'undefined',
        pref,
        raw: `${alias}@${pref}`,
      };
    }
  );
}

function getNotBundledDeps(
  bundledDeps: Set<string>,
  deps: Dependencies
): Record<string, string> {
  return pickBy.default((_, depName) => !bundledDeps.has(depName), deps);
}
