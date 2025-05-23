import path from 'node:path';
import type { DepTypes } from '../lockfile.detect-dep-types/index.ts';
import type { Registries } from '../types/index.ts';
import type { SearchFunction } from './types.ts';
import type { PackageNode } from './PackageNode.ts';
import { getPkgInfo } from './getPkgInfo.ts';
import { getTreeNodeChildId } from './getTreeNodeChildId.ts';
import { DependenciesCache } from './DependenciesCache.ts';
import { serializeTreeNodeId, type TreeNodeId } from './TreeNodeId.ts';
import type {
  ProjectSnapshot,
  PackageSnapshots,
  PackageSnapshot,
} from '../lockfile.types/index.ts';

type GetTreeOpts = {
  maxDepth: number;
  rewriteLinkVersionDir: string;
  includeOptionalDependencies: boolean;
  excludePeerDependencies?: boolean | undefined;
  lockfileDir: string;
  onlyProjects?: boolean | undefined;
  search?: SearchFunction | undefined;
  skipped: Set<string>;
  registries: Registries;
  importers: Record<string, ProjectSnapshot>;
  depTypes: DepTypes;
  currentPackages: PackageSnapshots;
  wantedPackages: PackageSnapshots;
  virtualStoreDir?: string | undefined;
  virtualStoreDirMaxLength: number;
};

type DependencyInfo = {
  dependencies: PackageNode[];

  circular?: true | undefined;

  /**
   * The number of edges along the longest path, including the parent node.
   *
   *   - `"unknown"` if traversal was limited by a max depth option, therefore
   *      making the true height of a package undetermined.
   *   - `0` if the dependencies array is empty.
   *   - `1` if the dependencies array has at least 1 element and no child
   *     dependencies.
   */
  height: number | 'unknown';
};

export function getTree(
  opts: GetTreeOpts,
  parentId: TreeNodeId
): PackageNode[] {
  const dependenciesCache = new DependenciesCache();

  return getTreeHelper(
    dependenciesCache,
    opts,
    Keypath.initialize(parentId),
    parentId
  ).dependencies;
}

function getTreeHelper(
  dependenciesCache: DependenciesCache,
  opts: GetTreeOpts,
  keypath: Keypath,
  parentId: TreeNodeId
): DependencyInfo {
  if (opts.maxDepth <= 0) {
    return { dependencies: [], height: 'unknown' };
  }

  function getSnapshot(
    treeNodeId: TreeNodeId
  ): ProjectSnapshot | PackageSnapshot | undefined {
    switch (treeNodeId.type) {
      case 'importer':
        return opts.importers[treeNodeId.importerId];
      case 'package':
        return opts.currentPackages[treeNodeId.depPath];
    }
  }

  const snapshot = getSnapshot(parentId);

  if (typeof snapshot === 'undefined') {
    return { dependencies: [], height: 0 };
  }

  const deps =
    opts.includeOptionalDependencies === true
      ? {
          ...snapshot.dependencies,
          ...snapshot.optionalDependencies,
        }
      : snapshot.dependencies;

  if (deps == null) {
    return { dependencies: [], height: 0 };
  }

  const childTreeMaxDepth = opts.maxDepth - 1;

  const getChildrenTree = getTreeHelper.bind(null, dependenciesCache, {
    ...opts,
    maxDepth: childTreeMaxDepth,
  });

  function getPeerDependencies(): Record<string, string> | undefined {
    switch (parentId.type) {
      case 'importer': {
        // Projects in the ospm workspace can declare peer dependencies, but ospm
        // doesn't record this block to the importers lockfile object. Returning
        // undefined for now.
        return undefined;
      }

      case 'package': {
        return opts.currentPackages[parentId.depPath]?.peerDependencies;
      }
    }
  }

  const peers = new Set(Object.keys(getPeerDependencies() ?? {}));

  // If the "ref" of any dependency is a file system path (e.g. link:../), the
  // base directory of this relative path depends on whether ;the dependent
  // package is in the ospm workspace or from node_modules.
  function getLinkedPathBaseDir(): string {
    switch (parentId.type) {
      case 'importer': {
        return path.join(opts.lockfileDir, parentId.importerId);
      }
      case 'package': {
        return opts.lockfileDir;
      }
    }
  }

  const linkedPathBaseDir = getLinkedPathBaseDir();

  const resultDependencies: PackageNode[] = [];

  let resultHeight: number | 'unknown' = 0;

  let resultCircular = false;

  for (const alias in deps) {
    const ref = deps[alias];

    if (typeof ref === 'undefined') {
      continue;
    }

    const packageInfo = getPkgInfo({
      alias,
      currentPackages: opts.currentPackages,
      depTypes: opts.depTypes,
      rewriteLinkVersionDir: opts.rewriteLinkVersionDir,
      linkedPathBaseDir,
      peers,
      ref,
      registries: opts.registries,
      skipped: opts.skipped,
      wantedPackages: opts.wantedPackages,
      virtualStoreDir: opts.virtualStoreDir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    });

    let circular: boolean;

    const matchedSearched = opts.search?.(packageInfo);

    let newEntry: PackageNode | null = null;

    const nodeId = getTreeNodeChildId({
      parentId,
      dep: { alias, ref },
      lockfileDir: opts.lockfileDir,
      importers: opts.importers,
    });

    if (opts.onlyProjects === true && nodeId?.type !== 'importer') {
      continue;
    }

    if (nodeId == null) {
      circular = false;

      if (opts.search == null || matchedSearched === true) {
        newEntry = packageInfo;
      }
    } else {
      let dependencies: PackageNode[] | undefined;

      circular = keypath.includes(nodeId);
      if (circular) {
        dependencies = [];
      } else {
        const cacheEntry = dependenciesCache.get({
          parentId: nodeId,
          requestedDepth: childTreeMaxDepth,
        });

        const children =
          cacheEntry ?? getChildrenTree(keypath.concat(nodeId), nodeId);

        if (cacheEntry == null && children.circular !== true) {
          if (children.height === 'unknown') {
            dependenciesCache.addPartiallyVisitedResult(nodeId, {
              dependencies: children.dependencies,
              depth: childTreeMaxDepth,
            });
          } else {
            dependenciesCache.addFullyVisitedResult(nodeId, {
              dependencies: children.dependencies,
              height: children.height,
            });
          }
        }
        const heightOfCurrentDepNode =
          children.height === 'unknown' ? 'unknown' : children.height + 1;

        dependencies = children.dependencies;
        resultHeight =
          resultHeight === 'unknown' || heightOfCurrentDepNode === 'unknown'
            ? 'unknown'
            : Math.max(resultHeight, heightOfCurrentDepNode);
        resultCircular = resultCircular || (children.circular ?? false);
      }

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
      if (circular) {
        newEntry.circular = true;
        resultCircular = true;
      }

      if (matchedSearched === true) {
        newEntry.searched = true;
      }

      if (
        !newEntry.isPeer ||
        opts.excludePeerDependencies !== true ||
        (typeof newEntry.dependencies?.length === 'number' &&
          newEntry.dependencies.length > 0)
      ) {
        resultDependencies.push(newEntry);
      }
    }
  }

  const result: DependencyInfo = {
    dependencies: resultDependencies,
    height: resultHeight,
  };

  if (resultCircular) {
    result.circular = resultCircular;
  }

  return result;
}

/**
 * Useful for detecting cycles.
 */
class Keypath {
  private constructor(private readonly keypath: readonly string[]) {}

  static initialize(treeNodeId: TreeNodeId): Keypath {
    return new Keypath([serializeTreeNodeId(treeNodeId)]);
  }

  includes(treeNodeId: TreeNodeId): boolean {
    return this.keypath.includes(serializeTreeNodeId(treeNodeId));
  }

  concat(treeNodeId: TreeNodeId): Keypath {
    return new Keypath([...this.keypath, serializeTreeNodeId(treeNodeId)]);
  }
}
