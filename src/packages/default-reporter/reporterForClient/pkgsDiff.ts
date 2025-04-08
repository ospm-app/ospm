import type * as logs from '../../core-loggers/index.ts';
import type { BaseManifest } from '../../types/index.ts';
import * as Rx from 'rxjs';
import {
  filter,
  map,
  mapTo,
  reduce,
  scan,
  startWith,
  take,
} from 'rxjs/operators';
import mergeRight from 'ramda/src/mergeRight';
import difference from 'ramda/src/difference';

export type PackageDiff = {
  added: boolean;
  from?: string | undefined;
  name: string;
  realName?: string | undefined;
  version?: string | undefined;
  deprecated?: boolean | undefined;
  latest?: string | undefined;
};

export type Map<T> = {
  [index: string]: T;
};

export const propertyByDependencyType = {
  dev: 'devDependencies',
  nodeModulesOnly: 'node_modules',
  optional: 'optionalDependencies',
  peer: 'peerDependencies',
  prod: 'dependencies',
} as const;

export type PkgsDiff = {
  dev: Map<PackageDiff>;
  nodeModulesOnly: Map<PackageDiff>;
  optional: Map<PackageDiff>;
  peer: Map<PackageDiff>;
  prod: Map<PackageDiff>;
};

export function getPkgsDiff(
  log$: {
    deprecation: Rx.Observable<logs.DeprecationLog>;
    summary: Rx.Observable<logs.SummaryLog>;
    root: Rx.Observable<logs.RootLog>;
    packageManifest: Rx.Observable<logs.PackageManifestLog>;
  },
  opts: {
    prefix: string;
  }
): Rx.Observable<PkgsDiff> {
  const deprecationSet$ = log$.deprecation.pipe(
    filter((log: logs.DeprecationLog): boolean => {
      return log.prefix === opts.prefix;
    }),
    scan((acc: Set<string>, log: logs.DeprecationLog): Set<string> => {
      acc.add(log.pkgId);
      return acc;
    }, new Set()),
    startWith(new Set<string>())
  );

  const filterPrefix = filter(
    (log: { prefix: string }) => log.prefix === opts.prefix
  );

  const pkgsDiff$ = Rx.combineLatest(
    log$.root.pipe(filterPrefix),
    deprecationSet$
  ).pipe(
    scan(
      (pkgsDiff, args) => {
        const rootLog = args[0];
        const deprecationSet = args[1] as Set<string>;
        let action: '-' | '+' | undefined;
        let log: any; // eslint-disable-line
        if ('added' in rootLog) {
          action = '+';
          log = rootLog['added'];
        } else if ('removed' in rootLog) {
          action = '-';
          log = rootLog['removed'];
        } else {
          return pkgsDiff;
        }
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        const depType = (log.dependencyType ||
          'nodeModulesOnly') as keyof typeof pkgsDiff;
        const oppositeKey = `${action === '-' ? '+' : '-'}${log.name as string}`;
        const previous = pkgsDiff[depType][oppositeKey];
        if (previous && previous.version === log.version) {
          delete pkgsDiff[depType][oppositeKey];
          return pkgsDiff;
        }
        pkgsDiff[depType][`${action}${log.name as string}`] = {
          added: action === '+',
          deprecated: deprecationSet.has(log.id),
          from: log.linkedFrom,
          latest: log.latest,
          name: log.name,
          realName: log.realName,
          version: log.version,
        };
        return pkgsDiff;
      },
      {
        dev: {},
        nodeModulesOnly: {},
        optional: {},
        peer: {},
        prod: {},
      } as PkgsDiff
    ),
    startWith({
      dev: {},
      nodeModulesOnly: {},
      optional: {},
      peer: {},
      prod: {},
    } as PkgsDiff)
  );

  const packageManifest$ = Rx.merge(
    log$.packageManifest.pipe(filterPrefix),
    log$.summary.pipe(filterPrefix, mapTo({}))
  ).pipe(
    take(2),
    reduce(mergeRight.default, {} as any) // eslint-disable-line @typescript-eslint/no-explicit-any
  ) as Rx.Observable<logs.PackageManifestLog>;

  return Rx.combineLatest(pkgsDiff$, packageManifest$).pipe(
    map(
      ([pkgsDiff, packageManifests]: [
        PkgsDiff,
        logs.PackageManifestLog,
      ]): PkgsDiff => {
        const init = packageManifests.initial;
        const upd = packageManifests.updated;

        if (typeof init === 'undefined' || typeof upd === 'undefined') {
          return pkgsDiff;
        }

        const initialPackageManifest = removeOptionalFromProdDeps(init);

        const updatedPackageManifest = removeOptionalFromProdDeps(upd);

        for (const depType of ['peer', 'prod', 'optional', 'dev'] as const) {
          const prop = propertyByDependencyType[depType];

          const initialDeps = Object.keys(initialPackageManifest[prop] ?? {});

          const updatedDeps = Object.keys(updatedPackageManifest[prop] ?? {});

          const removedDeps = difference.default(initialDeps, updatedDeps);

          for (const removedDep of removedDeps) {
            if (!pkgsDiff[depType][`-${removedDep}`]) {
              pkgsDiff[depType][`-${removedDep}`] = {
                added: false,
                name: removedDep,
                version: initialPackageManifest[prop]?.[removedDep],
              };
            }
          }

          const addedDeps = difference.default(updatedDeps, initialDeps);

          for (const addedDep of addedDeps) {
            if (!pkgsDiff[depType][`+${addedDep}`]) {
              pkgsDiff[depType][`+${addedDep}`] = {
                added: true,
                name: addedDep,
                version: updatedPackageManifest[prop]?.[addedDep],
              };
            }
          }
        }
        return pkgsDiff;
      }
    )
  );
}

function removeOptionalFromProdDeps<Pkg extends BaseManifest>(pkg: Pkg): Pkg {
  if (pkg.dependencies == null || pkg.optionalDependencies == null) {
    return pkg;
  }

  for (const depName of Object.keys(pkg.dependencies)) {
    if (typeof pkg.optionalDependencies[depName] !== 'undefined') {
      delete pkg.dependencies[depName];
    }
  }

  return pkg;
}
