import { logger } from '../logger/index.ts';
import { pruneSharedLockfile } from '../lockfile.pruner/index.ts';
import type { Resolution } from '../resolver-base/index.ts';
import type { DepPath, Registries } from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import getNpmTarballUrl from 'get-npm-tarball-url';
import type { KeyValuePair } from 'ramda';
import partition from 'ramda/src/partition';
import { depPathToRef } from './depPathToRef.ts';
import type { ResolvedPackage } from './resolveDependencies.ts';
import type { DependenciesGraph } from './index.ts';
import type {
  LockfileObject,
  PackageSnapshot,
} from '../lockfile.types/index.ts';
import type { GenericDependenciesGraphWithResolvedChildren } from './resolvePeers.ts';

export type LockfileResolution =
  | Resolution
  | {
      type?: never;
      integrity: string;
      directory?: never;
      commit?: never;
      repo?: never;
      tarball?: string | undefined;
      path?: never;
    };

export function updateLockfile({
  dependenciesGraph,
  lockfile,
  prefix,
  registries,
  lockfileIncludeTarballUrl,
}: {
  dependenciesGraph: GenericDependenciesGraphWithResolvedChildren;
  lockfile: LockfileObject;
  prefix: string;
  registries: Registries;
  lockfileIncludeTarballUrl?: boolean | undefined;
}): LockfileObject {
  lockfile.packages = lockfile.packages ?? {};
  for (const [depPath, depNode] of Object.entries(dependenciesGraph)) {
    const [updatedOptionalDeps, updatedDeps] = partition.default(
      (child: {
        alias: string;
        depPath: DepPath;
      }): boolean => {
        return (
          depNode.optionalDependencies.has(child.alias) === true ||
          depNode.peerDependencies[child.alias]?.optional === true
        );
      },
      Object.entries<DepPath>(depNode.children).map(([alias, depPath]) => {
        return {
          alias,
          depPath,
        };
      })
    );

    lockfile.packages[depPath as DepPath] = toLockfileDependency(depNode, {
      depGraph: dependenciesGraph,
      depPath,
      prevSnapshot: lockfile.packages[depPath as DepPath],
      registries,
      registry: dp.getRegistryByPackageName(registries, depNode.name),
      updatedDeps,
      updatedOptionalDeps,
      lockfileIncludeTarballUrl,
    });
  }

  function warn(message: string): void {
    logger.warn({ message, prefix });
  }

  return pruneSharedLockfile(lockfile, { warn, dependenciesGraph });
}

function toLockfileDependency(
  pkg: ResolvedPackage,
  opts: {
    depPath: string;
    registry: string;
    registries: Registries;
    updatedDeps: Array<{ alias: string; depPath: DepPath }>;
    updatedOptionalDeps: Array<{ alias: string; depPath: DepPath }>;
    depGraph: DependenciesGraph;
    prevSnapshot?: PackageSnapshot | undefined;
    lockfileIncludeTarballUrl?: boolean | undefined;
  }
): PackageSnapshot {
  const lockfileResolution = toLockfileResolution(
    { name: pkg.name, version: pkg.version },
    pkg.resolution,
    opts.registry,
    opts.lockfileIncludeTarballUrl
  );

  const newResolvedDeps = updateResolvedDeps(opts.updatedDeps, opts.depGraph);

  const newResolvedOptionalDeps = updateResolvedDeps(
    opts.updatedOptionalDeps,
    opts.depGraph
  );

  const result: {
    resolution: LockfileResolution;
    version?: string | undefined;
    dependencies?: Record<string, string> | undefined;
    optionalDependencies?: Record<string, string> | undefined;
    optional?: boolean | undefined;
    transitivePeerDependencies?: string[] | undefined;
    peerDependencies?: Record<string, string> | undefined;
    peerDependenciesMeta?: Record<string, { optional: true }> | undefined;
    engines?: Record<string, string> | undefined;
    cpu?: string[] | undefined;
    os?: string[] | undefined;
    libc?: string[] | undefined;
    bundledDependencies?: string[] | boolean | undefined;
    deprecated?: string | undefined;
    hasBin?: boolean | undefined;
    patched?: boolean | undefined;
  } = {
    resolution: lockfileResolution,
  };

  if (opts.depPath.includes(':')) {
    // There is no guarantee that a non-npmjs.org-hosted package is going to have a version field.
    // Also, for local directory dependencies, the version is not needed.
    if (
      pkg.version &&
      (!('type' in lockfileResolution) ||
        lockfileResolution.type !== 'directory')
    ) {
      result.version = pkg.version;
    }
  }

  if (Object.keys(newResolvedDeps).length > 0) {
    result.dependencies = newResolvedDeps;
  }

  if (Object.keys(newResolvedOptionalDeps).length > 0) {
    result.optionalDependencies = newResolvedOptionalDeps;
  }

  if (pkg.optional === true) {
    result.optional = true;
  }

  if (pkg.transitivePeerDependencies.size) {
    result.transitivePeerDependencies = Array.from(
      pkg.transitivePeerDependencies
    ).sort();
  }

  if (Object.keys(pkg.peerDependencies).length > 0) {
    const peerPkgs: Record<string, string> = {};

    const normalizedPeerDependenciesMeta: Record<string, { optional: true }> =
      {};

    for (const [peer, { version, optional }] of Object.entries(
      pkg.peerDependencies
    )) {
      peerPkgs[peer] = version;

      if (optional === true) {
        normalizedPeerDependenciesMeta[peer] = { optional: true };
      }
    }

    result.peerDependencies = peerPkgs;

    if (Object.keys(normalizedPeerDependenciesMeta).length > 0) {
      result.peerDependenciesMeta = normalizedPeerDependenciesMeta;
    }
  }

  if (pkg.additionalInfo.engines != null) {
    for (const [engine, version] of Object.entries(
      pkg.additionalInfo.engines
    )) {
      if (version === '*') continue;
      result.engines = result.engines || {};

      if (typeof version === 'string') {
        result.engines[engine] = version;
      }
    }
  }

  if (pkg.additionalInfo.cpu != null) {
    result.cpu = pkg.additionalInfo.cpu;
  }

  if (pkg.additionalInfo.os != null) {
    result.os = pkg.additionalInfo.os;
  }

  if (pkg.additionalInfo.libc != null) {
    result.libc = pkg.additionalInfo.libc;
  }

  if (
    Array.isArray(pkg.additionalInfo.bundledDependencies) ||
    pkg.additionalInfo.bundledDependencies === true
  ) {
    result.bundledDependencies = pkg.additionalInfo.bundledDependencies;
  } else if (
    Array.isArray(pkg.additionalInfo.bundleDependencies) ||
    pkg.additionalInfo.bundleDependencies === true
  ) {
    result.bundledDependencies = pkg.additionalInfo.bundleDependencies;
  }

  if (typeof pkg.additionalInfo.deprecated === 'string') {
    result.deprecated = pkg.additionalInfo.deprecated;
  }

  if (pkg.hasBin) {
    result.hasBin = true;
  }

  if (pkg.patch) {
    result.patched = true;
  }

  return result;
}

function updateResolvedDeps(
  updatedDeps: Array<{ alias: string; depPath: DepPath }>,
  depGraph: DependenciesGraph
): Record<string, string> {
  return Object.fromEntries(
    updatedDeps.map(
      ({
        alias,
        depPath,
      }: {
        alias: string;
        depPath: DepPath;
      }): KeyValuePair<string, string> => {
        if (depPath.startsWith('link:')) {
          return [alias, depPath];
        }

        const depNode = depGraph[depPath];

        if (typeof depNode === 'undefined') {
          return [alias, depPath];
        }

        return [
          alias,
          depPathToRef(depPath, {
            alias,
            realName: depNode.name,
          }),
        ];
      }
    )
  );
}

function toLockfileResolution(
  pkg: {
    name: string;
    version: string;
  },
  resolution: Resolution | undefined,
  registry: string,
  lockfileIncludeTarballUrl?: boolean
): LockfileResolution {
  if (
    typeof resolution !== 'undefined' &&
    (('type' in resolution && typeof resolution.type !== 'undefined') ||
      typeof resolution.integrity === 'undefined')
  ) {
    return resolution as LockfileResolution;
  }

  if (lockfileIncludeTarballUrl === true) {
    return {
      integrity: resolution?.integrity,
      tarball: resolution?.tarball,
    } satisfies LockfileResolution;
  }

  // Sometimes packages are hosted under non-standard tarball URLs.
  // For instance, when they are hosted on npm Enterprise. See https://github.com/pnpm/pnpm/issues/867
  // Or in other weird cases, like https://github.com/pnpm/pnpm/issues/1072
  const expectedTarball = getNpmTarballUrl(pkg.name, pkg.version, { registry });

  const actualTarball = resolution?.tarball?.replace('%2f', '/');

  if (
    typeof actualTarball === 'string' &&
    removeProtocol(expectedTarball) !== removeProtocol(actualTarball)
  ) {
    return {
      integrity: resolution?.integrity,
      tarball: resolution?.tarball,
    };
  }

  return {
    integrity: resolution?.integrity,
  };
}

function removeProtocol(url: string): string {
  return url.split('://')[1] ?? '';
}
