import {
  matchCatalogResolveResult,
  resolveFromCatalog,
  type CatalogResolutionFound,
} from '../catalogs.resolver/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';
import { LOCKFILE_VERSION, WANTED_LOCKFILE } from '../constants/index.ts';
import { OspmError } from '../error/index.ts';
import { getLockfileImporterId } from '../lockfile.fs/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import { parsePref } from '../npm-resolver/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import {
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  type IncludedDependencies,
  type PackageManifest,
  type ProjectManifest,
  type Registries,
  type LockFileDir,
} from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import semver from 'semver';
import { createMatcher } from '../matcher/index.ts';
import { createReadPackageHook } from '../hooks.read-package-hook/index.ts';
import { parseOverrides } from '../parse-overrides/index.ts';
import type { WantedDependency } from '../resolve-dependencies/getWantedDependencies.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';

export type GetLatestManifestFunction = (
  packageName: string,
  rangeOrTag: string
) => Promise<PackageManifest | null>;

export type OutdatedPackage = {
  alias: string;
  belongsTo: DependenciesField;
  current?: string | undefined; // not defined means the package is not installed
  latestManifest?: PackageManifest | undefined;
  packageName: string;
  wanted: string;
  workspace?: string | undefined;
};

export async function outdated(opts: {
  catalogs?: Catalogs | undefined;
  compatible?: boolean | undefined;
  currentLockfile: LockfileObject | null;
  getLatestManifest: GetLatestManifestFunction;
  ignoreDependencies?: string[] | undefined;
  include?: IncludedDependencies | undefined;
  lockfileDir: LockFileDir;
  manifest: ProjectManifest;
  match?: ((dependencyName: string) => boolean) | undefined;
  prefix: string;
  registries: Registries;
  wantedLockfile: LockfileObject | null;
}): Promise<OutdatedPackage[]> {
  if (packageHasNoDeps(opts.manifest)) {
    return [];
  }

  if (opts.wantedLockfile == null) {
    throw new OspmError(
      'OUTDATED_NO_LOCKFILE',
      `No lockfile in directory "${opts.lockfileDir}". Run \`ospm install\` to generate one.`
    );
  }

  async function getOverriddenManifest(): Promise<ProjectManifest> {
    const overrides =
      opts.currentLockfile?.overrides ?? opts.wantedLockfile?.overrides;

    if (overrides) {
      const readPackageHook = createReadPackageHook({
        lockfileDir: opts.lockfileDir,
        overrides: parseOverrides(overrides, opts.catalogs ?? {}),
      });

      const manifest = await readPackageHook?.(opts.manifest, opts.lockfileDir);

      if (manifest) {
        return manifest;
      }
    }

    return opts.manifest;
  }

  const allDeps = getAllDependenciesFromManifest(await getOverriddenManifest());

  const importerId = getLockfileImporterId(opts.lockfileDir, opts.prefix);

  const currentLockfile: LockfileObject = opts.currentLockfile ?? {
    lockfileVersion: LOCKFILE_VERSION,
    importers: { [importerId]: { specifiers: {} } },
  };

  const outdated: OutdatedPackage[] = [];

  const ignoreDependenciesMatcher =
    typeof opts.ignoreDependencies?.length === 'number' &&
    opts.ignoreDependencies.length > 0
      ? createMatcher(opts.ignoreDependencies)
      : undefined;

  await Promise.all(
    DEPENDENCIES_FIELDS.map(
      async (depType: DependenciesField): Promise<void> => {
        if (
          opts.include?.[depType] === false ||
          opts.wantedLockfile?.importers?.[importerId]?.[depType] == null
        )
          return;

        let pkgs = Object.keys(
          opts.wantedLockfile.importers[importerId][depType]
        );

        if (opts.match != null) {
          pkgs = pkgs.filter((pkgName): boolean => {
            return opts.match?.(pkgName) === true;
          });
        }

        const _replaceCatalogProtocolIfNecessary =
          replaceCatalogProtocolIfNecessary.bind(null, opts.catalogs ?? {});

        await Promise.all(
          pkgs.map(async (alias: string): Promise<void> => {
            if (typeof allDeps[alias] === 'undefined') {
              return;
            }

            const ref =
              opts.wantedLockfile?.importers?.[importerId]?.[depType]?.[alias];

            if (
              typeof ref === 'undefined' ||
              ref.startsWith('file:') === true || // ignoring linked packages. (For backward compatibility)
              ignoreDependenciesMatcher?.(alias) === true
            ) {
              return;
            }

            const relativeDepPath = dp.refToRelative(ref, alias);

            // ignoring linked packages
            if (relativeDepPath === null) return;

            const pkgSnapshot =
              opts.wantedLockfile?.packages?.[relativeDepPath];

            if (typeof pkgSnapshot === 'undefined') {
              throw new Error(
                `Invalid ${WANTED_LOCKFILE} file. ${relativeDepPath} not found in packages field`
              );
            }

            const importer = currentLockfile.importers?.[importerId];

            if (typeof importer === 'undefined') {
              throw new Error(
                `Invalid ${WANTED_LOCKFILE} file. importer ${importerId} not found in importers field`
              );
            }

            const currentRef = importer[depType]?.[alias];

            if (typeof currentRef !== 'undefined') {
              const currentRelative = dp.refToRelative(currentRef, alias);

              const current =
                currentRelative !== null
                  ? (dp.parse(currentRelative).version ?? currentRef)
                  : currentRef;

              const wanted = dp.parse(relativeDepPath).version ?? ref;

              const { name: packageName } = nameVerFromPkgSnapshot(
                relativeDepPath,
                pkgSnapshot
              );

              const name = dp.parse(relativeDepPath).name ?? packageName;

              const pref = _replaceCatalogProtocolIfNecessary({
                alias,
                pref: allDeps[alias],
              });

              // If the npm resolve parser cannot parse the spec of the dependency,
              // it means that the package is not from a npm-compatible registry.
              // In that case, we can't check whether the package is up-to-date
              if (
                typeof pref !== 'undefined' &&
                parsePref(
                  pref,
                  alias,
                  'latest',
                  pickRegistryForPackage(opts.registries, name)
                ) == null
              ) {
                if (current !== wanted) {
                  outdated.push({
                    alias,
                    belongsTo: depType,
                    current,
                    latestManifest: undefined,
                    packageName,
                    wanted,
                    workspace: opts.manifest.name,
                  });
                }
                return;
              }

              const latestManifest = await opts.getLatestManifest(
                name,
                opts.compatible === true
                  ? typeof pref === 'string'
                    ? pref
                    : 'latest'
                  : 'latest'
              );

              if (latestManifest == null) {
                return;
              }

              if (!current) {
                outdated.push({
                  alias,
                  belongsTo: depType,
                  latestManifest,
                  packageName,
                  wanted,
                  workspace: opts.manifest.name,
                });

                return;
              }

              if (
                current !== wanted ||
                semver.lt(current, latestManifest.version) ||
                typeof latestManifest.deprecated === 'string'
              ) {
                outdated.push({
                  alias,
                  belongsTo: depType,
                  current,
                  latestManifest,
                  packageName,
                  wanted,
                  workspace: opts.manifest.name,
                });
              }
            }
          })
        );
      }
    )
  );

  return outdated.sort(
    (pkg1: OutdatedPackage, pkg2: OutdatedPackage): number => {
      return pkg1.packageName.localeCompare(pkg2.packageName);
    }
  );
}

function packageHasNoDeps(manifest: ProjectManifest): boolean {
  return (
    (manifest.dependencies == null || isEmpty(manifest.dependencies)) &&
    (manifest.devDependencies == null || isEmpty(manifest.devDependencies)) &&
    (manifest.optionalDependencies == null ||
      isEmpty(manifest.optionalDependencies))
  );
}

function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

function replaceCatalogProtocolIfNecessary(
  catalogs: Catalogs,
  wantedDependency: WantedDependency
): string | undefined {
  return matchCatalogResolveResult(
    resolveFromCatalog(catalogs, wantedDependency),
    {
      unused: () => wantedDependency.pref,
      found: (found: CatalogResolutionFound) => found.resolution.specifier,
      misconfiguration: (misconfiguration) => {
        throw misconfiguration.error;
      },
    }
  );
}
