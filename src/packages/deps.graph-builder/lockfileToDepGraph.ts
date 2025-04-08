import path from 'node:path';
import { WANTED_LOCKFILE } from '../constants/index.ts';
import { progressLogger } from '../core-loggers/index.ts';
import {
  nameVerFromPkgSnapshot,
  packageIdFromSnapshot,
  pkgSnapshotToResolution,
} from '../lockfile.utils/index.ts';
import { logger } from '../logger/index.ts';
import type { IncludedDependencies } from '../modules-yaml/index.ts';
import { packageIsInstallable } from '../package-is-installable/index.ts';
import { getPatchInfo } from '../patching.config/index.ts';
import type { PatchGroupRecord, PatchInfo } from '../patching.types/index.ts';
import type {
  DepPath,
  SupportedArchitectures,
  Registries,
  PkgIdWithPatchHash,
  ProjectId,
  ModulesDir,
} from '../types/index.ts';
import type {
  StoreController,
  PackageResponse,
  PkgRequestFetchResult,
} from '../store-controller-types/index.ts';
import * as dp from '../dependency-path/index.ts';
import { pathExists } from 'path-exists';
import equals from 'ramda/src/equals';
import isEmpty from 'ramda/src/isEmpty';
import type {
  LockfileObject,
  PackageSnapshot,
} from '../lockfile.types/index.ts';

const brokenModulesLogger = logger('_broken_node_modules');

// PkgRequestFetchResult<unknown>

// {
//   files: {
//     unprocessed: boolean;
//     resolvedFrom: 'store' | 'local-dir' | 'remote';
//     filesIndex: PackageFiles;
//     packageImportMethod?:
//       | 'auto'
//       | 'hardlink'
//       | 'copy'
//       | 'clone'
//       | 'clone-or-copy'
//       | undefined;
//     requiresBuild: boolean;
//     sideEffects?: SideEffects | undefined;
//   };
//   bundledManifest: BundledManifest | undefined;
// }

export type DependenciesGraphNode = {
  alias?: string | undefined; // this is populated in HoistedDepGraphOnly
  hasBundledDependencies: boolean;
  modules: ModulesDir;
  name: string;
  fetching?: (() => Promise<PkgRequestFetchResult<unknown>>) | undefined;
  dir: string;
  children: Record<string, string>;
  optionalDependencies: Set<string>;
  optional: boolean;
  depPath: DepPath; // this option is only needed for saving pendingBuild when running with --ignore-scripts flag
  pkgIdWithPatchHash: PkgIdWithPatchHash;
  isBuilt: boolean;
  requiresBuild?: boolean | undefined;
  hasBin: boolean;
  filesIndexFile?: string | undefined;
  patch?: PatchInfo | undefined;
};

export type DependenciesGraph = {
  [depPath: string]: DependenciesGraphNode;
};

export type LockfileToDepGraphOptions = {
  autoInstallPeers: boolean;
  engineStrict: boolean;
  force: boolean;
  importerIds: ProjectId[];
  include: IncludedDependencies;
  ignoreScripts: boolean;
  lockfileDir: string;
  nodeVersion?: string | undefined;
  pnpmVersion?: string | undefined;
  patchedDependencies?: PatchGroupRecord | undefined;
  registries: Registries;
  sideEffectsCacheRead: boolean;
  skipped: Set<DepPath>;

  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  storeDir: string;
  virtualStoreDir: string;
  supportedArchitectures?: SupportedArchitectures | undefined;
  virtualStoreDirMaxLength: number;
};

export type DirectDependenciesByImporterId = {
  [importerId: string]: { [alias: string]: string };
};

export type DepHierarchy = {
  [depPath: string]: Record<string, DepHierarchy>;
};

export type LockfileToDepGraphResult = {
  directDependenciesByImporterId: DirectDependenciesByImporterId;
  graph: DependenciesGraph;
  hierarchy?: DepHierarchy | undefined;
  hoistedLocations?: Record<string, string[]> | undefined;
  symlinkedDirectDependenciesByImporterId: DirectDependenciesByImporterId;
  prevGraph?: DependenciesGraph | undefined;
  pkgLocationsByDepPath?: Record<string, string[]> | undefined;
};

export async function lockfileToDepGraph(
  lockfile: LockfileObject,
  currentLockfile: LockfileObject | null,
  opts: LockfileToDepGraphOptions
): Promise<{
  graph: DependenciesGraph;
  directDependenciesByImporterId: DirectDependenciesByImporterId;
}> {
  const currentPackages = currentLockfile?.packages ?? {};

  const graph: DependenciesGraph = {};

  const directDependenciesByImporterId: DirectDependenciesByImporterId = {};

  if (typeof lockfile.packages !== 'undefined') {
    const pkgSnapshotByLocation: Record<string, PackageSnapshot> = {};

    const _getPatchInfo = getPatchInfo.bind(null, opts.patchedDependencies);

    await Promise.all(
      (
        Object.entries(lockfile.packages) as Array<[DepPath, PackageSnapshot]>
      ).map(
        async ([depPath, pkgSnapshot]: [
          DepPath,
          PackageSnapshot,
        ]): Promise<void> => {
          if (opts.skipped.has(depPath)) {
            return;
          }

          // TODO: optimize. This info can be already returned by pkgSnapshotToResolution()
          const { name: pkgName, version: pkgVersion } = nameVerFromPkgSnapshot(
            depPath,
            pkgSnapshot
          );

          const modules = path.join(
            opts.virtualStoreDir,
            dp.depPathToFilename(depPath, opts.virtualStoreDirMaxLength),
            'node_modules'
          ) as ModulesDir;

          const packageId = packageIdFromSnapshot(depPath, pkgSnapshot);

          const pkgIdWithPatchHash = dp.getPkgIdWithPatchHash(depPath);

          const pkg = {
            name: pkgName,
            version: pkgVersion,
            engines: pkgSnapshot.engines,
            cpu: pkgSnapshot.cpu,
            os: pkgSnapshot.os,
            libc: pkgSnapshot.libc,
          };

          if (
            !opts.force &&
            (await packageIsInstallable(packageId, pkg, {
              engineStrict: opts.engineStrict,
              lockfileDir: opts.lockfileDir,
              nodeVersion: opts.nodeVersion,
              optional: pkgSnapshot.optional === true,
              supportedArchitectures: opts.supportedArchitectures,
            })) === false
          ) {
            opts.skipped.add(depPath);

            return;
          }

          const dir = path.join(modules, pkgName);

          const depIsPresent =
            !(
              typeof pkgSnapshot.resolution !== 'undefined' &&
              'directory' in pkgSnapshot.resolution &&
              typeof pkgSnapshot.resolution.directory === 'string'
            ) &&
            currentPackages[depPath] &&
            equals.default(
              currentPackages[depPath].dependencies,
              lockfile.packages?.[depPath]?.dependencies
            );

          let dirExists: boolean | undefined;

          if (
            depIsPresent === true &&
            isEmpty.default(
              currentPackages[depPath]?.optionalDependencies ?? {}
            ) &&
            isEmpty.default(
              lockfile.packages?.[depPath]?.optionalDependencies ?? {}
            )
          ) {
            dirExists = await pathExists(dir);

            if (dirExists) {
              return;
            }

            brokenModulesLogger.debug({
              missing: dir,
            });
          }

          let fetchResponse: Partial<PackageResponse> | undefined;

          if (
            depIsPresent === true &&
            equals.default(
              currentPackages[depPath]?.optionalDependencies,
              lockfile.packages?.[depPath]?.optionalDependencies
            )
          ) {
            if (dirExists ?? (await pathExists(dir))) {
              fetchResponse = {};
            } else {
              brokenModulesLogger.debug({
                missing: dir,
              });
            }
          }

          if (typeof fetchResponse === 'undefined') {
            const resolution = pkgSnapshotToResolution(
              depPath,
              pkgSnapshot,
              opts.registries
            );

            progressLogger.debug({
              packageId,
              requester: opts.lockfileDir,
              status: 'resolved',
            });

            try {
              const fr = opts.storeController.fetchPackage({
                force: false,
                lockfileDir: opts.lockfileDir,
                ignoreScripts: opts.ignoreScripts,
                pkg: {
                  id: packageId,
                  resolution,
                },
                expectedPkg: {
                  name: pkgName,
                  version: pkgVersion,
                },
              });

              fetchResponse = fr instanceof Promise ? await fr : fr;
            } catch (err: unknown) {
              if (pkgSnapshot.optional === true) {
                return;
              }

              throw err;
            }
          }

          graph[dir] = {
            isBuilt: false,
            children: {},
            pkgIdWithPatchHash,
            depPath,
            dir,
            fetching: fetchResponse.fetching,
            filesIndexFile: fetchResponse.filesIndexFile,
            hasBin: pkgSnapshot.hasBin === true,
            hasBundledDependencies: pkgSnapshot.bundledDependencies != null,
            modules,
            name: pkgName,
            optional: pkgSnapshot.optional === true,
            optionalDependencies: new Set(
              Object.keys(pkgSnapshot.optionalDependencies ?? {})
            ),
            patch: _getPatchInfo(pkgName, pkgVersion),
          };

          pkgSnapshotByLocation[dir] = pkgSnapshot;
        }
      )
    );

    const ctx = {
      force: opts.force,
      graph,
      lockfileDir: opts.lockfileDir,
      pkgSnapshotsByDepPaths: lockfile.packages,
      registries: opts.registries,
      sideEffectsCacheRead: opts.sideEffectsCacheRead,
      skipped: opts.skipped,
      storeController: opts.storeController,
      storeDir: opts.storeDir,
      virtualStoreDir: opts.virtualStoreDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    };

    for (const [dir, node] of Object.entries(graph)) {
      const pkgSnapshot = pkgSnapshotByLocation[dir];

      const allDeps = {
        ...pkgSnapshot?.dependencies,
        ...(opts.include.optionalDependencies
          ? pkgSnapshot?.optionalDependencies
          : {}),
      };

      const peerDeps = pkgSnapshot?.peerDependencies
        ? new Set(Object.keys(pkgSnapshot.peerDependencies))
        : null;
      node.children = getChildrenPaths(ctx, allDeps, peerDeps, '.');
    }

    for (const importerId of opts.importerIds) {
      const projectSnapshot = lockfile.importers?.[importerId];

      const rootDeps = {
        ...(opts.include.devDependencies
          ? projectSnapshot?.devDependencies
          : {}),
        ...(opts.include.dependencies ? projectSnapshot?.dependencies : {}),
        ...(opts.include.optionalDependencies
          ? projectSnapshot?.optionalDependencies
          : {}),
      };

      directDependenciesByImporterId[importerId] = getChildrenPaths(
        ctx,
        rootDeps,
        null,
        importerId
      );
    }
  }

  return { graph, directDependenciesByImporterId };
}

function getChildrenPaths<IP>(
  ctx: {
    graph: DependenciesGraph;
    force: boolean;
    registries: Registries;
    virtualStoreDir: string;
    storeDir: string;
    skipped: Set<DepPath>;
    pkgSnapshotsByDepPaths: Record<DepPath, PackageSnapshot>;
    lockfileDir: string;
    sideEffectsCacheRead: boolean;
    storeController: StoreController<PackageResponse, PackageResponse, IP>;
    virtualStoreDirMaxLength: number;
  },
  allDeps: { [alias: string]: string },
  peerDeps: Set<string> | null,
  importerId: string
): { [alias: string]: string } {
  const children: { [alias: string]: string } = {};

  for (const [alias, ref] of Object.entries(allDeps)) {
    const childDepPath = dp.refToRelative(ref, alias);

    if (childDepPath === null) {
      children[alias] = path.resolve(ctx.lockfileDir, importerId, ref.slice(5));

      continue;
    }

    const childRelDepPath = dp.refToRelative(ref, alias);

    if (typeof childRelDepPath === 'string') {
      const childPkgSnapshot = ctx.pkgSnapshotsByDepPaths[childRelDepPath];

      if (ctx.graph[childRelDepPath]) {
        children[alias] = ctx.graph[childRelDepPath].dir;
      } else if (childPkgSnapshot) {
        if (ctx.skipped.has(childRelDepPath)) continue;

        const pkgName = nameVerFromPkgSnapshot(
          childRelDepPath,
          childPkgSnapshot
        ).name;

        children[alias] = path.join(
          ctx.virtualStoreDir,
          dp.depPathToFilename(childRelDepPath, ctx.virtualStoreDirMaxLength),
          'node_modules',
          pkgName
        );
      } else if (ref.indexOf('file:') === 0) {
        children[alias] = path.resolve(ctx.lockfileDir, ref.slice(5));
      } else if (
        !ctx.skipped.has(childRelDepPath) &&
        (peerDeps == null || !peerDeps.has(alias))
      ) {
        throw new Error(`${childRelDepPath} not found in ${WANTED_LOCKFILE}`);
      }
    }
  }

  return children;
}
