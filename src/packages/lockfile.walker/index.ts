import type {
  LockfileObject,
  PackageSnapshot,
} from '../lockfile.types/index.ts';
import type { DependenciesField, DepPath, ProjectId } from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';

export type LockedDependency = {
  depPath: DepPath;
  pkgSnapshot: PackageSnapshot;
  next: () => LockfileWalkerStep;
};

export type LockfileWalkerStep = {
  dependencies: LockedDependency[];
  links: string[];
  missing: string[];
};

export function lockfileWalkerGroupImporterSteps(
  lockfile: LockfileObject,
  importerIds: ProjectId[],
  opts?:
    | {
        include?:
          | { [dependenciesField in DependenciesField]: boolean }
          | undefined;
        skipped?: Set<DepPath> | undefined;
      }
    | undefined
): Array<{ importerId: string; step: LockfileWalkerStep }> {
  const walked = new Set<DepPath>(
    opts?.skipped != null ? Array.from(opts.skipped) : []
  );

  return importerIds.map(
    (
      importerId: ProjectId
    ): {
      importerId: ProjectId;
      step: LockfileWalkerStep;
    } => {
      const projectSnapshot = lockfile.importers?.[importerId];

      const entryNodes = Object.entries({
        ...(opts?.include?.devDependencies === false
          ? {}
          : projectSnapshot?.devDependencies),
        ...(opts?.include?.dependencies === false
          ? {}
          : projectSnapshot?.dependencies),
        ...(opts?.include?.optionalDependencies === false
          ? {}
          : projectSnapshot?.optionalDependencies),
      })
        .map(([pkgName, reference]) => dp.refToRelative(reference, pkgName))
        .filter((nodeId) => nodeId !== null) as DepPath[];

      return {
        importerId,
        step: step(
          {
            includeOptionalDependencies:
              opts?.include?.optionalDependencies !== false,
            lockfile,
            walked,
          },
          entryNodes
        ),
      };
    }
  );
}

export interface LockfileWalker {
  directDeps: Array<{
    alias: string;
    depPath: DepPath;
  }>;
  step: LockfileWalkerStep;
}

export function lockfileWalker(
  lockfile: LockfileObject,
  importerIds: ProjectId[],
  opts?:
    | {
        include?:
          | { [dependenciesField in DependenciesField]: boolean }
          | undefined;
        skipped?: Set<DepPath> | undefined;
      }
    | undefined
): LockfileWalker {
  const walked = new Set<DepPath>(
    opts?.skipped != null ? Array.from(opts.skipped) : []
  );
  const entryNodes = [] as DepPath[];
  const directDeps = [] as Array<{ alias: string; depPath: DepPath }>;

  for (const importerId of importerIds) {
    const projectSnapshot = lockfile.importers?.[importerId];

    const entries = Object.entries({
      ...(opts?.include?.devDependencies === false
        ? {}
        : projectSnapshot?.devDependencies),
      ...(opts?.include?.dependencies === false
        ? {}
        : projectSnapshot?.dependencies),
      ...(opts?.include?.optionalDependencies === false
        ? {}
        : projectSnapshot?.optionalDependencies),
    });

    for (const [pkgName, reference] of entries) {
      const depPath = dp.refToRelative(reference, pkgName);

      if (depPath === null) {
        continue;
      }

      entryNodes.push(depPath);

      directDeps.push({ alias: pkgName, depPath });
    }
  }

  return {
    directDeps,
    step: step(
      {
        includeOptionalDependencies:
          opts?.include?.optionalDependencies !== false,
        lockfile,
        walked,
      },
      entryNodes
    ),
  };
}

function step(
  ctx: {
    includeOptionalDependencies: boolean;
    lockfile: LockfileObject;
    walked: Set<DepPath>;
  },
  nextDepPaths: DepPath[]
): LockfileWalkerStep {
  const result: LockfileWalkerStep = {
    dependencies: [],
    links: [],
    missing: [],
  };
  for (const depPath of nextDepPaths) {
    if (ctx.walked.has(depPath)) continue;
    ctx.walked.add(depPath);
    const pkgSnapshot = ctx.lockfile.packages?.[depPath];
    if (pkgSnapshot == null) {
      if (depPath.startsWith('link:')) {
        result.links.push(depPath);
        continue;
      }
      result.missing.push(depPath);
      continue;
    }
    result.dependencies.push({
      depPath,
      next: () =>
        step(
          ctx,
          next(
            { includeOptionalDependencies: ctx.includeOptionalDependencies },
            pkgSnapshot
          )
        ),
      pkgSnapshot,
    });
  }
  return result;
}

function next(
  opts: { includeOptionalDependencies: boolean },
  nextPkg: PackageSnapshot
): DepPath[] {
  return Object.entries({
    ...nextPkg.dependencies,
    ...(opts.includeOptionalDependencies ? nextPkg.optionalDependencies : {}),
  })
    .map(([pkgName, reference]) => dp.refToRelative(reference, pkgName))
    .filter((nodeId) => nodeId !== null) as DepPath[];
}
