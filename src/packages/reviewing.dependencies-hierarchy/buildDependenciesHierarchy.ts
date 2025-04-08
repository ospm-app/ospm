import path from 'node:path';
import {
  getLockfileImporterId,
  readCurrentLockfile,
  readWantedLockfile,
} from '../lockfile.fs/index.ts';
import { detectDepTypes } from '../lockfile.detect-dep-types/index.ts';
import { readModulesManifest } from '../modules-yaml/index.ts';
import { normalizeRegistries } from '../normalize-registries/index.ts';
import { readModulesDir } from '../read-modules-dir/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import {
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  type Registries,
  type ModulesDir,
} from '../types/index.ts';
import normalizePath from 'normalize-path';
import realpathMissing from 'realpath-missing';
import resolveLinkTarget from 'resolve-link-target';
import type { PackageNode } from './PackageNode.ts';
import type { SearchFunction } from './types.ts';
import { getTree } from './getTree.ts';
import { getTreeNodeChildId } from './getTreeNodeChildId.ts';
import { getPkgInfo } from './getPkgInfo.ts';
import type { TreeNodeId } from './TreeNodeId.ts';
import type {
  LockfileObject,
  ProjectSnapshot,
  ResolvedDependencies,
} from '../lockfile.types/index.ts';

export type DependenciesHierarchy = {
  dependencies?: PackageNode[] | undefined;
  devDependencies?: PackageNode[] | undefined;
  optionalDependencies?: PackageNode[] | undefined;
  unsavedDependencies?: PackageNode[] | undefined;
};

export async function buildDependenciesHierarchy(
  projectPaths: string[] | undefined,
  maybeOpts: {
    depth?: number | undefined;
    excludePeerDependencies?: boolean | undefined;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    registries?: Registries | undefined;
    onlyProjects?: boolean | undefined;
    search?: SearchFunction | undefined;
    lockfileDir: string;
    modulesDir?: string | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<{ [projectDir: string]: DependenciesHierarchy }> {
  let newProjectPaths = projectPaths;

  if (!maybeOpts.lockfileDir) {
    throw new TypeError('opts.lockfileDir is required');
  }

  const modulesDir: ModulesDir = (await realpathMissing(
    path.join(maybeOpts.lockfileDir, maybeOpts.modulesDir ?? 'node_modules')
  )) as ModulesDir;

  const modules = await readModulesManifest(modulesDir);

  const registries = normalizeRegistries({
    ...maybeOpts.registries,
    ...modules?.registries,
  });

  const currentLockfile =
    (typeof modules?.virtualStoreDir === 'string' &&
      (await readCurrentLockfile(modules.virtualStoreDir, {
        ignoreIncompatible: false,
      }))) ??
    null;

  const wantedLockfile = await readWantedLockfile(maybeOpts.lockfileDir, {
    ignoreIncompatible: false,
  });

  if (typeof newProjectPaths === 'undefined') {
    newProjectPaths = Object.keys(wantedLockfile?.importers ?? {}).map((id) =>
      path.join(maybeOpts.lockfileDir, id)
    );
  }

  const result = {} as { [projectDir: string]: DependenciesHierarchy };

  if (currentLockfile === null || currentLockfile === false) {
    for (const projectPath of newProjectPaths) {
      result[projectPath] = {};
    }

    return result;
  }

  const opts = {
    depth: maybeOpts.depth ?? 0,
    excludePeerDependencies: maybeOpts.excludePeerDependencies,
    include: maybeOpts.include ?? {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    lockfileDir: maybeOpts.lockfileDir,
    onlyProjects: maybeOpts.onlyProjects,
    registries,
    search: maybeOpts.search,
    skipped: new Set(modules?.skipped ?? []),
    modulesDir: maybeOpts.modulesDir,
    virtualStoreDir: modules?.virtualStoreDir,
    virtualStoreDirMaxLength:
      modules?.virtualStoreDirMaxLength ?? maybeOpts.virtualStoreDirMaxLength,
  };

  const pairs = await Promise.all(
    newProjectPaths.map(async (projectPath) => {
      return [
        projectPath,
        await dependenciesHierarchyForPackage(
          projectPath,
          currentLockfile,
          wantedLockfile,
          opts
        ),
      ] as [string, DependenciesHierarchy];
    })
  );
  for (const [projectPath, dependenciesHierarchy] of pairs) {
    result[projectPath] = dependenciesHierarchy;
  }
  return result;
}

async function dependenciesHierarchyForPackage(
  projectPath: string,
  currentLockfile: LockfileObject,
  wantedLockfile: LockfileObject | null,
  opts: {
    depth: number;
    excludePeerDependencies?: boolean | undefined;
    include: { [dependenciesField in DependenciesField]: boolean };
    registries: Registries;
    onlyProjects?: boolean | undefined;
    search?: SearchFunction | undefined;
    skipped: Set<string>;
    lockfileDir: string;
    modulesDir?: string | undefined;
    virtualStoreDir?: string | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<DependenciesHierarchy> {
  const importerId = getLockfileImporterId(opts.lockfileDir, projectPath);

  if (!currentLockfile.importers?.[importerId]) {
    return {};
  }

  const modulesDir = path.join(projectPath, opts.modulesDir ?? 'node_modules');

  const savedDeps = getAllDirectDependencies(
    currentLockfile.importers[importerId]
  );

  const allDirectDeps = (await readModulesDir(modulesDir)) ?? [];

  const unsavedDeps = allDirectDeps.filter((directDep): boolean => {
    return typeof savedDeps[directDep] !== 'string';
  });

  const depTypes = detectDepTypes(currentLockfile);

  const getChildrenTree = getTree.bind(null, {
    currentPackages: currentLockfile.packages ?? {},
    excludePeerDependencies: opts.excludePeerDependencies,
    importers: currentLockfile.importers,
    includeOptionalDependencies: opts.include.optionalDependencies,
    depTypes,
    lockfileDir: opts.lockfileDir,
    onlyProjects: opts.onlyProjects,
    rewriteLinkVersionDir: projectPath,
    maxDepth: opts.depth,
    registries: opts.registries,
    search: opts.search,
    skipped: opts.skipped,
    wantedPackages: wantedLockfile?.packages ?? {},
    virtualStoreDir: opts.virtualStoreDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
  });

  const parentId: TreeNodeId = { type: 'importer', importerId };

  const result: DependenciesHierarchy = {};

  for (const dependenciesField of DEPENDENCIES_FIELDS.sort().filter(
    (dependenciesField) => opts.include[dependenciesField]
  )) {
    const topDeps =
      currentLockfile.importers[importerId][dependenciesField] ?? {};
    result[dependenciesField] = [];
    for (const alias in topDeps) {
      const ref = topDeps[alias];

      if (typeof ref === 'undefined') {
        continue;
      }

      const packageInfo = getPkgInfo({
        alias,
        currentPackages: currentLockfile.packages ?? {},
        depTypes,
        rewriteLinkVersionDir: projectPath,
        linkedPathBaseDir: projectPath,
        ref,
        registries: opts.registries,
        skipped: opts.skipped,
        wantedPackages: wantedLockfile?.packages ?? {},
        virtualStoreDir: opts.virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      });
      let newEntry: PackageNode | null = null;
      const matchedSearched = opts.search?.(packageInfo);
      const nodeId = getTreeNodeChildId({
        parentId,
        dep: { alias, ref },
        lockfileDir: opts.lockfileDir,
        importers: currentLockfile.importers,
      });

      if (opts.onlyProjects === true && nodeId?.type !== 'importer') {
        continue;
      }

      if (nodeId == null) {
        if (opts.search != null && matchedSearched !== true) {
          continue;
        }
        newEntry = packageInfo;
      } else {
        const dependencies = getChildrenTree(nodeId);

        if (dependencies.length > 0) {
          newEntry = {
            ...packageInfo,
            dependencies,
          };
        } else if (opts.search == null || matchedSearched === true) {
          newEntry = packageInfo;
        }
      }

      if (newEntry != null) {
        if (matchedSearched === true) {
          newEntry.searched = true;
        }

        result[dependenciesField].push(newEntry);
      }
    }
  }

  await Promise.all(
    unsavedDeps.map(async (unsavedDep) => {
      let pkgPath = path.join(modulesDir, unsavedDep);

      let version!: string;

      try {
        pkgPath = await resolveLinkTarget(pkgPath);

        version = `link:${normalizePath(path.relative(projectPath, pkgPath))}`;
      } catch {
        // if error happened. The package is not a link
        const pkg = await safeReadPackageJsonFromDir(pkgPath);

        version = pkg?.version ?? 'undefined';
      }

      const pkg = {
        alias: unsavedDep,
        isMissing: false,
        isPeer: false,
        isSkipped: false,
        name: unsavedDep,
        path: pkgPath,
        version,
      };

      const matchedSearched = opts.search?.(pkg);

      if (opts.search != null && matchedSearched !== true) {
        return;
      }

      const newEntry: PackageNode = pkg;

      if (matchedSearched === true) {
        newEntry.searched = true;
      }

      result.unsavedDependencies = result.unsavedDependencies ?? [];

      result.unsavedDependencies.push(newEntry);
    })
  );

  return result;
}

function getAllDirectDependencies(
  projectSnapshot: ProjectSnapshot
): ResolvedDependencies {
  return {
    ...projectSnapshot.dependencies,
    ...projectSnapshot.devDependencies,
    ...projectSnapshot.optionalDependencies,
  };
}
