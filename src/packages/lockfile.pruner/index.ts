import { LOCKFILE_VERSION } from '../constants/index.ts';
import type {
  LockfileObject,
  PackageSnapshots,
  ProjectSnapshot,
  ResolvedDependencies,
} from '../lockfile.types/index.ts';
import type { DepPath, PackageManifest, ProjectId } from '../types/index.ts';
import { refToRelative } from '../dependency-path/index.ts';
import difference from 'ramda/src/difference';
import isEmpty from 'ramda/src/isEmpty';
import unnest from 'ramda/src/unnest';
import type { DependenciesGraph } from '../resolve-dependencies/index.ts';
import type { GenericDependenciesGraphWithResolvedChildren } from '../resolve-dependencies/resolvePeers.ts';

export function pruneSharedLockfile(
  lockfile: LockfileObject,
  opts?:
    | {
        dependenciesGraph?:
          | GenericDependenciesGraphWithResolvedChildren
          | undefined;
        warn?: ((msg: string) => void) | undefined;
      }
    | undefined
): LockfileObject {
  const copiedPackages =
    lockfile.packages == null
      ? {}
      : copyPackageSnapshots(lockfile.packages, {
          devDepPaths: unnest.default(
            Object.values(lockfile.importers ?? {}).map(
              (deps: ProjectSnapshot): DepPath[] => {
                return resolvedDepsToDepPaths(deps.devDependencies ?? {});
              }
            )
          ),
          optionalDepPaths: unnest.default(
            Object.values(lockfile.importers ?? {}).map(
              (deps: ProjectSnapshot): DepPath[] => {
                return resolvedDepsToDepPaths(deps.optionalDependencies ?? {});
              }
            )
          ),
          prodDepPaths: unnest.default(
            Object.values(lockfile.importers ?? {}).map(
              (deps: ProjectSnapshot): DepPath[] => {
                return resolvedDepsToDepPaths(deps.dependencies ?? {});
              }
            )
          ),
          warn:
            opts?.warn ??
            ((_msg: string): undefined => {
              return undefined;
            }),
          dependenciesGraph: opts?.dependenciesGraph,
        });

  const prunedLockfile: LockfileObject = {
    ...lockfile,
    packages: copiedPackages,
  };

  if (isEmpty.default(prunedLockfile.packages)) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete prunedLockfile.packages;
  }

  return prunedLockfile;
}

export function pruneLockfile(
  lockfile: LockfileObject,
  pkg: PackageManifest,
  importerId: ProjectId,
  opts: {
    warn?: ((msg: string) => void) | undefined;
    dependenciesGraph?: DependenciesGraph;
  }
): LockfileObject {
  const importer = lockfile.importers?.[importerId];

  const lockfileSpecs: ResolvedDependencies = importer?.specifiers ?? {};
  const optionalDependencies = Object.keys(pkg.optionalDependencies ?? {});
  const dependencies = difference.default(
    Object.keys(pkg.dependencies ?? {}),
    optionalDependencies
  );
  const devDependencies = difference.default(
    difference.default(
      Object.keys(pkg.devDependencies ?? {}),
      optionalDependencies
    ),
    dependencies
  );
  const allDeps = new Set([
    ...optionalDependencies,
    ...devDependencies,
    ...dependencies,
  ]);

  const specifiers: ResolvedDependencies = {};
  const lockfileDependencies: ResolvedDependencies = {};
  const lockfileOptionalDependencies: ResolvedDependencies = {};
  const lockfileDevDependencies: ResolvedDependencies = {};

  for (const depName in lockfileSpecs) {
    if (!allDeps.has(depName)) {
      continue;
    }

    const spec = lockfileSpecs[depName];

    if (typeof spec !== 'undefined') {
      specifiers[depName] = spec;
    }

    const dep = importer?.dependencies?.[depName];
    const opDep = importer?.optionalDependencies?.[depName];
    const devDep = importer?.devDependencies?.[depName];

    if (typeof dep !== 'undefined') {
      lockfileDependencies[depName] = dep;
    } else if (typeof opDep !== 'undefined') {
      lockfileOptionalDependencies[depName] = opDep;
    } else if (typeof devDep !== 'undefined') {
      lockfileDevDependencies[depName] = devDep;
    }
  }
  if (importer?.dependencies != null) {
    for (const [alias, dep] of Object.entries(importer.dependencies)) {
      const depAlias = lockfileDependencies[alias];
      const specAlias = lockfileSpecs[alias];

      if (
        typeof depAlias === 'undefined' &&
        dep.startsWith('link:') &&
        // If the linked dependency was removed from package.json
        // then it is removed from pnpm-lock.yaml as well
        typeof specAlias === 'undefined' &&
        !allDeps.has(alias)
      ) {
        lockfileDependencies[alias] = dep;
      }
    }
  }

  const updatedImporter: ProjectSnapshot = {
    specifiers,
  };

  const prunedLockfile: LockfileObject = {
    importers: {
      ...lockfile.importers,
      [importerId]: updatedImporter,
    },
    lockfileVersion: lockfile.lockfileVersion || LOCKFILE_VERSION,
    packages: lockfile.packages,
  };

  if (!isEmpty.default(lockfileDependencies)) {
    updatedImporter.dependencies = lockfileDependencies;
  }

  if (!isEmpty.default(lockfileOptionalDependencies)) {
    updatedImporter.optionalDependencies = lockfileOptionalDependencies;
  }

  if (!isEmpty.default(lockfileDevDependencies)) {
    updatedImporter.devDependencies = lockfileDevDependencies;
  }

  if (typeof lockfile.pnpmfileChecksum === 'string') {
    prunedLockfile.pnpmfileChecksum = lockfile.pnpmfileChecksum;
  }

  if (
    lockfile.ignoredOptionalDependencies &&
    !isEmpty.default(lockfile.ignoredOptionalDependencies)
  ) {
    prunedLockfile.ignoredOptionalDependencies =
      lockfile.ignoredOptionalDependencies;
  }

  return pruneSharedLockfile(prunedLockfile, opts);
}

function copyPackageSnapshots(
  originalPackages: PackageSnapshots,
  opts: {
    devDepPaths: DepPath[];
    optionalDepPaths: DepPath[];
    prodDepPaths: DepPath[];
    warn: (msg: string) => void;
    dependenciesGraph?:
      | GenericDependenciesGraphWithResolvedChildren
      | undefined;
  }
): PackageSnapshots {
  const copiedSnapshots: PackageSnapshots = {};
  const ctx = {
    copiedSnapshots,
    nonOptional: new Set<string>(),
    originalPackages,
    walked: new Set<string>(),
    warn: opts.warn,
    dependenciesGraph: opts.dependenciesGraph,
  };

  copyDependencySubGraph(ctx, opts.devDepPaths, {
    optional: false,
  });
  copyDependencySubGraph(ctx, opts.optionalDepPaths, {
    optional: true,
  });
  copyDependencySubGraph(ctx, opts.prodDepPaths, {
    optional: false,
  });

  return copiedSnapshots;
}

function resolvedDepsToDepPaths(deps: ResolvedDependencies): DepPath[] {
  return Object.entries(deps)
    .map(([alias, ref]) => refToRelative(ref, alias))
    .filter((depPath) => depPath !== null) as DepPath[];
}

function copyDependencySubGraph(
  ctx: {
    copiedSnapshots: PackageSnapshots;
    nonOptional: Set<string>;
    originalPackages: PackageSnapshots;
    walked: Set<string>;
    warn: (msg: string) => void;
    dependenciesGraph?:
      | GenericDependenciesGraphWithResolvedChildren
      | undefined;
  },
  depPaths: DepPath[],
  opts: {
    optional: boolean;
  }
): void {
  for (const depPath of depPaths) {
    const key = `${depPath}:${opts.optional.toString()}`;

    if (ctx.walked.has(key)) {
      continue;
    }

    ctx.walked.add(key);

    if (!ctx.originalPackages[depPath]) {
      // local dependencies don't need to be resolved in pnpm-lock.yaml
      // except local tarball dependencies
      if (
        depPath.startsWith('link:') ||
        (depPath.startsWith('file:') && !depPath.endsWith('.tar.gz'))
      )
        continue;

      ctx.warn(`Cannot find resolution of ${depPath} in lockfile`);
      continue;
    }
    const depLockfile = ctx.originalPackages[depPath];
    ctx.copiedSnapshots[depPath] = depLockfile;
    if (opts.optional && !ctx.nonOptional.has(depPath)) {
      depLockfile.optional = true;
      if (ctx.dependenciesGraph?.[depPath]) {
        ctx.dependenciesGraph[depPath].optional = true;
      }
    } else {
      ctx.nonOptional.add(depPath);

      // biome-ignore lint/performance/noDelete: <explanation>
      delete depLockfile.optional;

      if (ctx.dependenciesGraph?.[depPath]) {
        ctx.dependenciesGraph[depPath].optional = false;
      }
    }
    const newDependencies = resolvedDepsToDepPaths(
      depLockfile.dependencies ?? {}
    );
    copyDependencySubGraph(ctx, newDependencies, opts);
    const newOptionalDependencies = resolvedDepsToDepPaths(
      depLockfile.optionalDependencies ?? {}
    );
    copyDependencySubGraph(ctx, newOptionalDependencies, { optional: true });
  }
}
