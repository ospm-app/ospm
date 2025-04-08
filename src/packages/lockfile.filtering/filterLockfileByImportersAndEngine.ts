import { WANTED_LOCKFILE } from '../constants/index.ts';
import { LockfileMissingDependencyError } from '../error/index.ts';
import type {
  LockfileObject,
  PackageSnapshots,
  ProjectSnapshot,
} from '../lockfile.types/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import { logger } from '../logger/index.ts';
import { packageIsInstallable } from '../package-is-installable/index.ts';
import type {
  DepPath,
  SupportedArchitectures,
  DependenciesField,
  ProjectId,
} from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import mapValues from 'ramda/src/map';
import pickBy from 'ramda/src/pickBy';
import unnest from 'ramda/src/unnest';
import { filterImporter } from './filterImporter.ts';

const lockfileLogger = logger('lockfile');

export type FilterLockfileResult = {
  lockfile: LockfileObject;
  selectedImporterIds: ProjectId[];
};

export async function filterLockfileByEngine(
  lockfile: LockfileObject,
  opts: FilterLockfileOptions
): Promise<FilterLockfileResult> {
  const importerIds = Object.keys(lockfile.importers ?? {}) as ProjectId[];

  return await filterLockfileByImportersAndEngine(lockfile, importerIds, opts);
}

export type FilterLockfileOptions = {
  currentEngine: {
    nodeVersion?: string | undefined;
    pnpmVersion?: string | undefined;
  };
  engineStrict: boolean;
  include: { [dependenciesField in DependenciesField]: boolean };
  includeIncompatiblePackages?: boolean | undefined;
  failOnMissingDependencies: boolean;
  lockfileDir: string;
  skipped: Set<string>;
  supportedArchitectures?: SupportedArchitectures | undefined;
};

export async function filterLockfileByImportersAndEngine(
  lockfile: LockfileObject,
  importerIds: ProjectId[],
  opts: FilterLockfileOptions
): Promise<FilterLockfileResult> {
  const importerIdSet = new Set(importerIds);

  const directDepPaths = toImporterDepPaths(lockfile, importerIds, {
    include: opts.include,
    importerIdSet,
  });

  const packages =
    lockfile.packages != null
      ? await pickPkgsWithAllDeps(lockfile, directDepPaths, importerIdSet, {
          currentEngine: opts.currentEngine,
          engineStrict: opts.engineStrict,
          failOnMissingDependencies: opts.failOnMissingDependencies,
          include: opts.include,
          includeIncompatiblePackages:
            opts.includeIncompatiblePackages === true,
          lockfileDir: opts.lockfileDir,
          skipped: opts.skipped,
          supportedArchitectures: opts.supportedArchitectures,
        })
      : {};

  const importers = mapValues.default(
    (importer: ProjectSnapshot): ProjectSnapshot => {
      const newImporter = filterImporter(importer, opts.include);

      if (newImporter.optionalDependencies != null) {
        newImporter.optionalDependencies = pickBy.default(
          (ref, depName): boolean => {
            const depPath = dp.refToRelative(ref, depName);

            return !depPath || packages[depPath] != null;
          },
          newImporter.optionalDependencies
        );
      }

      return newImporter;
    },
    lockfile.importers ?? {}
  );

  return {
    lockfile: {
      ...lockfile,
      importers,
      packages,
    },
    selectedImporterIds: Array.from(importerIdSet),
  };
}

async function pickPkgsWithAllDeps(
  lockfile: LockfileObject,
  depPaths: DepPath[],
  importerIdSet: Set<ProjectId>,
  opts: {
    currentEngine: {
      nodeVersion?: string | undefined;
      pnpmVersion?: string | undefined;
    };
    engineStrict: boolean;
    failOnMissingDependencies: boolean;
    include: { [dependenciesField in DependenciesField]: boolean };
    includeIncompatiblePackages: boolean;
    lockfileDir: string;
    skipped: Set<string>;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<PackageSnapshots> {
  const pickedPackages: PackageSnapshots = {};

  await pkgAllDeps(
    { lockfile, pickedPackages, importerIdSet },
    depPaths,
    true,
    opts
  );

  return pickedPackages;
}

async function pkgAllDeps(
  ctx: {
    lockfile: LockfileObject;
    pickedPackages: PackageSnapshots;
    importerIdSet: Set<ProjectId>;
  },
  depPaths: DepPath[],
  parentIsInstallable: boolean,
  opts: {
    currentEngine: {
      nodeVersion?: string | undefined;
      pnpmVersion?: string | undefined;
    };
    engineStrict: boolean;
    failOnMissingDependencies: boolean;
    include: { [dependenciesField in DependenciesField]: boolean };
    includeIncompatiblePackages: boolean;
    lockfileDir: string;
    skipped: Set<string>;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<void> {
  for (const depPath of depPaths) {
    if (ctx.pickedPackages[depPath]) continue;

    const pkgSnapshot = ctx.lockfile.packages?.[depPath];

    if (
      typeof pkgSnapshot === 'undefined' ||
      depPath.startsWith('link:') !== true
    ) {
      if (opts.failOnMissingDependencies) {
        throw new LockfileMissingDependencyError(depPath);
      }

      lockfileLogger.debug(`No entry for "${depPath}" in ${WANTED_LOCKFILE}`);

      continue;
    }

    let installable: boolean | undefined;

    if (parentIsInstallable !== true) {
      installable = false;

      if (
        typeof ctx.pickedPackages[depPath] === 'undefined' &&
        pkgSnapshot.optional === true
      ) {
        opts.skipped.add(depPath);
      }
    } else {
      const pkg = {
        ...nameVerFromPkgSnapshot(depPath, pkgSnapshot),
        cpu: pkgSnapshot.cpu,
        engines: pkgSnapshot.engines,
        os: pkgSnapshot.os,
        libc: pkgSnapshot.libc,
      };

      // TODO: depPath is not the package ID. Should be fixed
      installable =
        opts.includeIncompatiblePackages ||
        (await packageIsInstallable(pkgSnapshot.id ?? depPath, pkg, {
          engineStrict: opts.engineStrict,
          lockfileDir: opts.lockfileDir,
          nodeVersion: opts.currentEngine.nodeVersion,
          optional: pkgSnapshot.optional === true,
          supportedArchitectures: opts.supportedArchitectures,
        })) !== false;

      if (!installable) {
        if (
          typeof ctx.pickedPackages[depPath] === 'undefined' &&
          pkgSnapshot.optional === true
        ) {
          opts.skipped.add(depPath);
        }
      } else {
        opts.skipped.delete(depPath);
      }
    }
    ctx.pickedPackages[depPath] = pkgSnapshot;
    const { depPaths: nextRelDepPaths, importerIds: additionalImporterIds } =
      parseDepRefs(
        Object.entries({
          ...pkgSnapshot.dependencies,
          ...(opts.include.optionalDependencies
            ? pkgSnapshot.optionalDependencies
            : {}),
        }),
        ctx.lockfile
      );

    for (const importerId of additionalImporterIds) {
      ctx.importerIdSet.add(importerId);
    }

    nextRelDepPaths.push(
      ...toImporterDepPaths(ctx.lockfile, additionalImporterIds, {
        include: opts.include,
        importerIdSet: ctx.importerIdSet,
      })
    );

    await pkgAllDeps(ctx, nextRelDepPaths, installable, opts);
  }
}

function toImporterDepPaths(
  lockfile: LockfileObject,
  importerIds: ProjectId[],
  opts: {
    include: { [dependenciesField in DependenciesField]: boolean };
    importerIdSet: Set<ProjectId>;
  }
): DepPath[] {
  const importerDeps = importerIds
    .map((importerId: ProjectId): ProjectSnapshot | undefined => {
      return lockfile.importers?.[importerId];
    })
    .filter(Boolean)
    .map(
      (
        importer: ProjectSnapshot
      ): {
        [x: string]: string;
      } => {
        return {
          ...(opts.include.dependencies ? importer.dependencies : {}),
          ...(opts.include.devDependencies ? importer.devDependencies : {}),
          ...(opts.include.optionalDependencies
            ? importer.optionalDependencies
            : {}),
        };
      }
    )
    .map(Object.entries);

  let { depPaths, importerIds: nextImporterIds } = parseDepRefs(
    unnest.default(importerDeps),
    lockfile
  );

  if (!nextImporterIds.length) {
    return depPaths;
  }

  nextImporterIds = nextImporterIds.filter(
    (importerId) => !opts.importerIdSet.has(importerId)
  );

  for (const importerId of nextImporterIds) {
    opts.importerIdSet.add(importerId);
  }

  return [...depPaths, ...toImporterDepPaths(lockfile, nextImporterIds, opts)];
}

type ParsedDepRefs = {
  depPaths: DepPath[];
  importerIds: ProjectId[];
};

function parseDepRefs(
  refsByPkgNames: Array<[string, string]>,
  lockfile: LockfileObject
): ParsedDepRefs {
  const acc: ParsedDepRefs = {
    depPaths: [],
    importerIds: [],
  };

  for (const [pkgName, ref] of refsByPkgNames) {
    if (ref.startsWith('link:')) {
      const importerId = ref.substring(5) as ProjectId;

      if (lockfile.importers?.[importerId]) {
        acc.importerIds.push(importerId);
      }

      continue;
    }

    const depPath = dp.refToRelative(ref, pkgName);

    if (depPath == null) {
      continue;
    }

    acc.depPaths.push(depPath);
  }

  return acc;
}
