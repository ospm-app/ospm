import { pathExists } from 'path-exists';
import path from 'node:path';

import {
  nameVerFromPkgSnapshot,
  packageIdFromSnapshot,
  pkgSnapshotToResolution,
} from '../lockfile.utils/index.ts';
import type { IncludedDependencies } from '../modules-yaml/index.ts';
import { packageIsInstallable } from '../package-is-installable/index.ts';
import { getPatchInfo } from '../patching.config/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import type {
  DepPath,
  SupportedArchitectures,
  ProjectId,
  Registries,
  LockFileDir,
  ModulesDir,
} from '../types/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import {
  hoist,
  type HoistingLimits,
  type HoisterResult,
} from '../real-hoist/index.ts';
import * as dp from '../dependency-path/index.ts';
import type {
  DependenciesGraph,
  DepHierarchy,
  DirectDependenciesByImporterId,
  LockfileToDepGraphResult,
} from '../deps.graph-builder/index.ts';
import type {
  LockfileObject,
  ProjectSnapshot,
  PackageSnapshot,
} from '../lockfile.types/index.ts';
import type { PatchGroupRecord } from '../patching.types/index.ts';

export type LockfileToHoistedDepGraphOptions = {
  autoInstallPeers: boolean;
  engineStrict: boolean;
  force: boolean;
  hoistingLimits: HoistingLimits;
  externalDependencies?: Set<string> | undefined;
  importerIds: string[];
  include: IncludedDependencies;
  ignoreScripts: boolean;
  currentHoistedLocations?: Record<string, string[]> | undefined;
  lockfileDir: LockFileDir;
  modulesDir: ModulesDir;
  nodeVersion?: string | undefined;
  pnpmVersion?: string | undefined;
  registries: Registries;
  patchedDependencies?: PatchGroupRecord | undefined;
  sideEffectsCacheRead: boolean;
  skipped: Set<string>;
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
};

export async function lockfileToHoistedDepGraph(
  lockfile: LockfileObject,
  currentLockfile: LockfileObject | null,
  opts: LockfileToHoistedDepGraphOptions
): Promise<LockfileToDepGraphResult> {
  let prevGraph: DependenciesGraph | undefined;

  if (typeof currentLockfile?.packages === 'undefined') {
    prevGraph = {};
  } else {
    prevGraph = (
      await _lockfileToHoistedDepGraph(currentLockfile, {
        ...opts,
        force: true,
        skipped: new Set(),
      })
    ).graph;
  }

  const obj = await _lockfileToHoistedDepGraph(lockfile, opts);

  return {
    ...obj,
    prevGraph,
  };
}

async function _lockfileToHoistedDepGraph(
  lockfile: LockfileObject,
  opts: LockfileToHoistedDepGraphOptions
): Promise<Omit<LockfileToDepGraphResult, 'prevGraph'>> {
  const tree = hoist(lockfile, {
    hoistingLimits: opts.hoistingLimits,
    externalDependencies: opts.externalDependencies,
    autoInstallPeers: opts.autoInstallPeers,
  });

  const graph: DependenciesGraph = {};

  const modulesDir: ModulesDir = path.join(
    opts.lockfileDir,
    opts.modulesDir
  ) as ModulesDir;

  const fetchDepsOpts = {
    ...opts,
    lockfile,
    graph,
    pkgLocationsByDepPath: {},
    hoistedLocations: {},
  };

  const hierarchy = {
    [opts.lockfileDir]: await fetchDeps(
      fetchDepsOpts,
      modulesDir,
      tree.dependencies
    ),
  };

  const directDependenciesByImporterId: DirectDependenciesByImporterId = {
    '.': directDepsMap(Object.keys(hierarchy[opts.lockfileDir] ?? {}), graph),
  };

  const symlinkedDirectDependenciesByImporterId: DirectDependenciesByImporterId =
    { '.': {} };

  await Promise.all(
    Array.from(tree.dependencies).map(
      async (rootDep: HoisterResult): Promise<void> => {
        const reference = Array.from(rootDep.references)[0];

        if (
          typeof reference !== 'undefined' &&
          reference.startsWith('workspace:')
        ) {
          const importerId = reference.replace('workspace:', '') as ProjectId;

          const projectDir = path.join(opts.lockfileDir, importerId);

          const modulesDir: ModulesDir = path.join(
            projectDir,
            'node_modules'
          ) as ModulesDir;

          const nextHierarchy = await fetchDeps(
            fetchDepsOpts,
            modulesDir,
            rootDep.dependencies
          );

          hierarchy[projectDir] = nextHierarchy;

          const importer = lockfile.importers?.[importerId];

          const importerDir = path.join(opts.lockfileDir, importerId);

          if (typeof importer !== 'undefined') {
            symlinkedDirectDependenciesByImporterId[importerId] =
              pickLinkedDirectDeps(importer, importerDir, opts.include);
          }

          directDependenciesByImporterId[importerId] = directDepsMap(
            Object.keys(nextHierarchy),
            graph
          );
        }
      }
    )
  );

  return {
    directDependenciesByImporterId,
    graph,
    hierarchy,
    pkgLocationsByDepPath: fetchDepsOpts.pkgLocationsByDepPath,
    symlinkedDirectDependenciesByImporterId,
    hoistedLocations: fetchDepsOpts.hoistedLocations,
  };
}

function directDepsMap(
  directDepDirs: string[],
  graph: DependenciesGraph
): Record<string, string> {
  const acc: Record<string, string> = {};

  for (const dir of directDepDirs) {
    const a = graph[dir]?.alias;

    if (typeof a !== 'undefined') {
      acc[a] = dir;
    }
  }

  return acc;
}

function pickLinkedDirectDeps(
  importer: ProjectSnapshot,
  importerDir: string,
  include: IncludedDependencies
): Record<string, string> {
  const rootDeps = {
    ...(include.devDependencies ? importer.devDependencies : {}),
    ...(include.dependencies ? importer.dependencies : {}),
    ...(include.optionalDependencies ? importer.optionalDependencies : {}),
  };

  const directDeps: Record<string, string> = {};

  for (const alias in rootDeps) {
    const ref = rootDeps[alias];

    if (ref?.startsWith('link:') === true) {
      directDeps[alias] = path.resolve(importerDir, ref.slice(5));
    }
  }

  return directDeps;
}

async function fetchDeps(
  opts: {
    graph: DependenciesGraph;
    lockfile: LockfileObject;
    pkgLocationsByDepPath: Record<string, string[]>;
    hoistedLocations: Record<string, string[]>;
  } & LockfileToHoistedDepGraphOptions,
  modules: ModulesDir,
  deps: Set<HoisterResult>
): Promise<DepHierarchy> {
  const depHierarchy: Record<string, DepHierarchy> = {};

  await Promise.all(
    Array.from(deps).map(async (dep: HoisterResult): Promise<void> => {
      const depPath = Array.from(dep.references)[0] as DepPath;

      if (
        opts.skipped.has(depPath) === true ||
        depPath.startsWith('workspace:')
      ) {
        return;
      }

      const pkgSnapshot = opts.lockfile.packages?.[depPath];

      if (!pkgSnapshot) {
        // it is a link
        return;
      }

      const { name: pkgName, version: pkgVersion } = nameVerFromPkgSnapshot(
        depPath,
        pkgSnapshot
      );

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
        opts.force !== true &&
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

      const dir = path.join(modules, dep.name);

      const depLocation = path.relative(opts.lockfileDir, dir);

      const resolution = pkgSnapshotToResolution(
        depPath,
        pkgSnapshot,
        opts.registries
      );

      let fetchResponse:
        | PackageResponse
        | {
            filesIndexFile: string | undefined;
          }
        | undefined;

      // We check for the existence of the package inside node_modules.
      // It will only be missing if the user manually removed it.
      // That shouldn't normally happen but Bit CLI does remove node_modules in component directories:
      // https://github.com/teambit/bit/blob/5e1eed7cd122813ad5ea124df956ee89d661d770/scopes/dependencies/dependency-resolver/dependency-installer.ts#L169
      //
      // We also verify that the package that is present has the expected version.
      // This check is required because there is no guarantee the modules manifest and current lockfile were
      // successfully saved after node_modules was changed during installation.
      const skipFetch =
        opts.currentHoistedLocations?.[depPath]?.includes(depLocation) ===
          true &&
        (await dirHasPackageJsonWithVersion(
          path.join(opts.lockfileDir, depLocation),
          pkgVersion
        ));

      const pkgResolution = {
        id: packageId,
        resolution,
      };

      if (skipFetch) {
        const { filesIndexFile } = opts.storeController.getFilesIndexFilePath({
          ignoreScripts: opts.ignoreScripts,
          pkg: pkgResolution,
        });

        fetchResponse = { filesIndexFile };
      } else {
        try {
          const fr = opts.storeController.fetchPackage({
            force: false,
            lockfileDir: opts.lockfileDir,
            ignoreScripts: opts.ignoreScripts,
            pkg: pkgResolution,
            expectedPkg: {
              name: pkgName,
              version: pkgVersion,
            },
          });

          fetchResponse = fr instanceof Promise ? await fr : fr;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          if (pkgSnapshot.optional === true) {
            return;
          }

          throw err;
        }
      }

      opts.graph[dir] = {
        isBuilt: false,
        alias: dep.name,
        children: {},
        depPath,
        pkgIdWithPatchHash,
        dir,
        fetching:
          'fetching' in fetchResponse ? fetchResponse.fetching : undefined,
        filesIndexFile: fetchResponse.filesIndexFile,
        hasBin: pkgSnapshot.hasBin === true,
        hasBundledDependencies: pkgSnapshot.bundledDependencies != null,
        modules,
        name: pkgName,
        optional: pkgSnapshot.optional === true,
        optionalDependencies: new Set(
          Object.keys(pkgSnapshot.optionalDependencies ?? {})
        ),
        patch: getPatchInfo(opts.patchedDependencies, pkgName, pkgVersion),
      };

      if (!opts.pkgLocationsByDepPath[depPath]) {
        opts.pkgLocationsByDepPath[depPath] = [];
      }

      opts.pkgLocationsByDepPath[depPath].push(dir);

      depHierarchy[dir] = await fetchDeps(
        opts,
        path.join(dir, 'node_modules') as ModulesDir,
        dep.dependencies
      );

      if (!opts.hoistedLocations[depPath]) {
        opts.hoistedLocations[depPath] = [];
      }

      opts.hoistedLocations[depPath].push(depLocation);

      opts.graph[dir].children = getChildren(
        pkgSnapshot,
        opts.pkgLocationsByDepPath,
        opts
      );
    })
  );

  return depHierarchy;
}

async function dirHasPackageJsonWithVersion(
  dir: string,
  expectedVersion?: string | undefined
): Promise<boolean> {
  if (typeof expectedVersion === 'undefined') {
    return pathExists(dir);
  }

  try {
    const manifest = await safeReadPackageJsonFromDir(dir);
    return manifest?.version === expectedVersion;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return pathExists(dir);
    }

    throw err;
  }
}

function getChildren(
  pkgSnapshot: PackageSnapshot,
  pkgLocationsByDepPath: Record<string, string[]>,
  opts: { include: IncludedDependencies }
): Record<string, string> {
  const allDeps = {
    ...pkgSnapshot.dependencies,
    ...(opts.include.optionalDependencies
      ? pkgSnapshot.optionalDependencies
      : {}),
  };

  const children: Record<string, string> = {};

  for (const [childName, childRef] of Object.entries(allDeps)) {
    const childDepPath = dp.refToRelative(childRef, childName);

    if (childDepPath && pkgLocationsByDepPath[childDepPath]) {
      const location = pkgLocationsByDepPath[childDepPath][0];

      if (typeof location === 'string') {
        children[childName] = location;
      }
    }
  }

  return children;
}
