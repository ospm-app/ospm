import filenamify from 'filenamify';
import { analyzeGraph, type Graph } from 'graph-cycles';
import path from 'node:path';
import pDefer, { type DeferredPromise } from 'p-defer';
import semver from 'semver';
import { semverUtils } from '@yarnpkg/core';
import type {
  DepPath,
  GlobalPkgDir,
  LockFileDir,
  ParentPackages,
  PeerDependencyIssues,
  PeerDependencyIssuesByProjects,
  PkgIdWithPatchHash,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import {
  depPathToFilename,
  createPeersDirSuffix,
  type PeerId,
} from '../dependency-path/index.ts';
import partition from 'ramda/src/partition';
import pick from 'ramda/src/pick';
import type { NodeId } from './nextNodeId.ts';
import type {
  ChildrenMap,
  PeerDependencies,
  DependenciesTree,
  DependenciesTreeNode,
  ResolvedPackage,
} from './resolveDependencies.ts';
import type { ResolvedImporters } from './resolveDependencyTree.ts';
import { mergePeers } from './mergePeers.ts';
import { dedupeInjectedDeps } from './dedupeInjectedDeps.ts';

export type BaseGenericDependenciesGraphNode = {
  // at this point the version is really needed only for logging
  modules: string;
  dir: string;
  depPath: DepPath;
  depth: number;
  peerDependencies?: PeerDependencies | undefined;
  optionalDependencies?: Set<string> | undefined;
  transitivePeerDependencies: Set<string>;
  installable: boolean;
  isBuilt: boolean;
  isPure: boolean;
  resolvedPeerNames: Set<string>;
  requiresBuild?: boolean | undefined;
};

export interface GenericDependenciesGraphNode
  extends BaseGenericDependenciesGraphNode {
  children?: Record<string, DepPath> | undefined;
  childrenNodeIds?: Record<string, NodeId> | undefined;
}

export interface GenericDependenciesGraphNodeWithResolvedChildren
  extends BaseGenericDependenciesGraphNode {
  children: Record<string, DepPath>;
}

export type PartialResolvedPackage = Pick<
  ResolvedPackage,
  'id' | 'pkgIdWithPatchHash' | 'name' | 'peerDependencies' | 'version'
>;

export type GenericDependenciesGraph = {
  [depPath: string]: PartialResolvedPackage & GenericDependenciesGraphNode;
};

export type GenericDependenciesGraphWithResolvedChildren = {
  [depPath: string]: ResolvedPackage &
    GenericDependenciesGraphNodeWithResolvedChildren;
};

export type ProjectToResolve = {
  directNodeIdsByAlias: Map<string, NodeId>;
  // only the top dependencies that were already installed
  // to avoid warnings about unresolved peer dependencies
  topParents: Array<{
    name: string;
    version: string;
    alias?: string | undefined;
    linkedDir?: NodeId | undefined;
  }>;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir; // is only needed for logging
  id: string;
};

export type DependenciesByProjectId = Record<string, Map<string, DepPath>>;

export async function resolvePeers(opts: {
  allPeerDepNames: Set<string>;
  projects: ProjectToResolve[];
  dependenciesTree: DependenciesTree;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  lockfileDir: string;
  resolvePeersFromWorkspaceRoot?: boolean | undefined;
  dedupePeerDependents?: boolean | undefined;
  dedupeInjectedDeps?: boolean | undefined;
  resolvedImporters: ResolvedImporters;
  peersSuffixMaxLength: number;
}): Promise<{
  dependenciesGraph: GenericDependenciesGraphWithResolvedChildren;
  dependenciesByProjectId: DependenciesByProjectId;
  peerDependencyIssuesByProjects: PeerDependencyIssuesByProjects;
}> {
  const depGraph: GenericDependenciesGraph = {};

  const pathsByNodeId = new Map<NodeId, DepPath>();

  const pathsByNodeIdPromises = new Map<NodeId, DeferredPromise<DepPath>>();

  const depPathsByPkgId = new Map<PkgIdWithPatchHash, Set<DepPath>>();

  const _createPkgsByName = createPkgsByName.bind(null, opts.dependenciesTree);

  const rootPkgsByName =
    opts.resolvePeersFromWorkspaceRoot === true
      ? getRootPkgsByName(opts.dependenciesTree, opts.projects)
      : {};

  const peerDependencyIssuesByProjects: PeerDependencyIssuesByProjects = {};

  const finishingList: FinishingResolutionPromise[] = [];

  const peersCache = new Map<PkgIdWithPatchHash, PeersCacheItem[]>();

  const purePkgs = new Set<PkgIdWithPatchHash>();

  for (const {
    directNodeIdsByAlias,
    topParents,
    rootDir,
    id,
  } of opts.projects) {
    const peerDependencyIssues: Pick<PeerDependencyIssues, 'bad' | 'missing'> =
      { bad: {}, missing: {} };

    const pkgsByName = Object.fromEntries(
      Object.entries({
        ...rootPkgsByName,
        ..._createPkgsByName({ directNodeIdsByAlias, topParents }),
      }).filter(([peerName]) => opts.allPeerDepNames.has(peerName))
    );

    for (const { nodeId } of Object.values(pkgsByName)) {
      if (nodeId && !pathsByNodeIdPromises.has(nodeId)) {
        pathsByNodeIdPromises.set(nodeId, pDefer());
      }
    }

    const { finishing } = await resolvePeersOfChildren(
      Object.fromEntries(directNodeIdsByAlias.entries()),
      pkgsByName,
      {
        allPeerDepNames: opts.allPeerDepNames,
        parentPkgsOfNode: new Map(),
        dependenciesTree: opts.dependenciesTree,
        depGraph,
        lockfileDir: opts.lockfileDir,
        parentNodeIds: [],
        parentDepPathsChain: [],
        pathsByNodeId,
        pathsByNodeIdPromises,
        depPathsByPkgId,
        peersCache,
        peerDependencyIssues,
        purePkgs,
        peersSuffixMaxLength: opts.peersSuffixMaxLength,
        rootDir,
        virtualStoreDir: opts.virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      }
    );

    if (typeof finishing !== 'undefined') {
      finishingList.push(finishing);
    }

    if (
      Object.keys(peerDependencyIssues.bad).length > 0 ||
      Object.keys(peerDependencyIssues.missing).length > 0
    ) {
      peerDependencyIssuesByProjects[id] = {
        ...peerDependencyIssues,
        ...mergePeers(peerDependencyIssues.missing),
      };
    }
  }

  await Promise.all(finishingList);

  const depGraphWithResolvedChildren = resolveChildren(depGraph);

  function resolveChildren(
    depGraph: GenericDependenciesGraph
  ): GenericDependenciesGraphWithResolvedChildren {
    for (const node of Object.values(depGraph)) {
      node.children = {};

      for (const [alias, childNodeId] of Object.entries<NodeId>(
        node.childrenNodeIds ?? {}
      )) {
        node.children[alias] =
          pathsByNodeId.get(childNodeId) ?? (childNodeId as unknown as DepPath);
      }

      // biome-ignore lint/performance/noDelete: <explanation>
      delete node.childrenNodeIds;
    }

    return depGraph as unknown as GenericDependenciesGraphWithResolvedChildren;
  }

  const dependenciesByProjectId: DependenciesByProjectId = {};

  for (const { directNodeIdsByAlias, id } of opts.projects) {
    dependenciesByProjectId[id] = new Map();

    for (const [alias, nodeId] of directNodeIdsByAlias.entries()) {
      const depPath = pathsByNodeId.get(nodeId);

      if (typeof depPath === 'string') {
        dependenciesByProjectId[id].set(alias, depPath);
      }
    }
  }

  if (opts.dedupeInjectedDeps === true) {
    dedupeInjectedDeps({
      dependenciesByProjectId,
      projects: opts.projects,
      depGraph: depGraphWithResolvedChildren,
      pathsByNodeId,
      lockfileDir: opts.lockfileDir,
      resolvedImporters: opts.resolvedImporters,
    });
  }

  if (opts.dedupePeerDependents === true) {
    const duplicates = Array.from(depPathsByPkgId.values()).filter(
      (item: Set<DepPath>): boolean => {
        return item.size > 1;
      }
    );

    const allDepPathsMap = deduplicateAll(
      depGraphWithResolvedChildren,
      duplicates
    );

    for (const { id } of opts.projects) {
      for (const [alias, depPath] of dependenciesByProjectId[id]?.entries() ??
        []) {
        dependenciesByProjectId[id]?.set(
          alias,
          allDepPathsMap[depPath] ?? depPath
        );
      }
    }
  }

  return {
    dependenciesGraph: depGraphWithResolvedChildren,
    dependenciesByProjectId,
    peerDependencyIssuesByProjects,
  };
}

function nodeDepsCount(
  node: GenericDependenciesGraphNodeWithResolvedChildren
): number {
  return Object.keys(node.children).length + node.resolvedPeerNames.size;
}

function deduplicateAll(
  depGraph: GenericDependenciesGraphWithResolvedChildren,
  duplicates: Array<Set<DepPath>>
): Record<DepPath, DepPath> {
  const { depPathsMap, remainingDuplicates } = deduplicateDepPaths(
    duplicates,
    depGraph
  );

  if (remainingDuplicates.length === duplicates.length) {
    return depPathsMap;
  }

  for (const node of Object.values(depGraph)) {
    for (const [alias, childDepPath] of Object.entries<DepPath>(
      node.children
    )) {
      if (depPathsMap[childDepPath]) {
        node.children[alias] = depPathsMap[childDepPath];
      }
    }
  }

  if (Object.keys(depPathsMap).length > 0) {
    return {
      ...depPathsMap,
      ...deduplicateAll(depGraph, remainingDuplicates),
    };
  }

  return depPathsMap;
}

type DeduplicateDepPathsResult = {
  depPathsMap: Record<DepPath, DepPath>;
  remainingDuplicates: Array<Set<DepPath>>;
};

function deduplicateDepPaths(
  duplicates: Array<Set<DepPath>>,
  depGraph: GenericDependenciesGraphWithResolvedChildren
): DeduplicateDepPathsResult {
  function depCountSorter(depPath1: DepPath, depPath2: DepPath): number {
    const node1 = depGraph[depPath1];

    const node2 = depGraph[depPath2];

    if (typeof node1 === 'undefined' || typeof node2 === 'undefined') {
      return 0;
    }

    return nodeDepsCount(node1) - nodeDepsCount(node2);
  }

  const depPathsMap: Record<DepPath, DepPath> = {};

  const remainingDuplicates: Array<Set<DepPath>> = [];

  for (const depPaths of duplicates) {
    const unresolvedDepPaths = new Set(depPaths.values());

    let currentDepPaths = [...depPaths].sort(depCountSorter);

    while (currentDepPaths.length) {
      const depPath1 = currentDepPaths.pop();

      if (typeof depPath1 === 'undefined') {
        continue;
      }

      const nextDepPaths = [];

      while (currentDepPaths.length) {
        const depPath2 = currentDepPaths.pop();

        if (typeof depPath2 === 'undefined') {
          continue;
        }

        if (isCompatibleAndHasMoreDeps(depGraph, depPath1, depPath2)) {
          depPathsMap[depPath2] = depPath1;
          unresolvedDepPaths.delete(depPath1);
          unresolvedDepPaths.delete(depPath2);
        } else {
          nextDepPaths.push(depPath2);
        }
      }

      nextDepPaths.push(...currentDepPaths);

      currentDepPaths = nextDepPaths.sort(depCountSorter);
    }

    if (unresolvedDepPaths.size) {
      remainingDuplicates.push(unresolvedDepPaths);
    }
  }

  return {
    depPathsMap,
    remainingDuplicates,
  };
}

function isCompatibleAndHasMoreDeps(
  depGraph: GenericDependenciesGraphWithResolvedChildren,
  depPath1: DepPath,
  depPath2: DepPath
): boolean {
  const node1 = depGraph[depPath1];

  const node2 = depGraph[depPath2];

  if (typeof node1 === 'undefined' || typeof node2 === 'undefined') {
    return false;
  }

  if (nodeDepsCount(node1) < nodeDepsCount(node2)) {
    return false;
  }

  const node1DepPathsSet = new Set(Object.values(node1.children));

  const node2DepPaths = Object.values(node2.children);

  if (!node2DepPaths.every((depPath) => node1DepPathsSet.has(depPath))) {
    return false;
  }

  for (const depPath of node2.resolvedPeerNames) {
    if (!node1.resolvedPeerNames.has(depPath)) return false;
  }

  return true;
}

function getRootPkgsByName(
  dependenciesTree: DependenciesTree,
  projects: ProjectToResolve[]
): ParentRefs {
  const rootProject =
    projects.length > 1 ? projects.find(({ id }) => id === '.') : null;
  return rootProject == null
    ? {}
    : createPkgsByName(dependenciesTree, rootProject);
}

function createPkgsByName(
  dependenciesTree: DependenciesTree,
  {
    directNodeIdsByAlias,
    topParents,
  }: {
    directNodeIdsByAlias: Map<string, NodeId>;
    topParents: Array<{
      name: string;
      version: string;
      alias?: string | undefined;
      linkedDir?: NodeId | undefined;
    }>;
  }
): ParentRefs {
  const parentRefs = toPkgByName(
    Array.from(directNodeIdsByAlias.entries()).map(
      ([alias, nodeId]: [string, NodeId]): {
        alias: string;
        node: DependenciesTreeNode | undefined;
        nodeId: NodeId;
        parentNodeIds: never[];
      } => {
        return {
          alias,
          node: dependenciesTree.get(nodeId),
          nodeId,
          parentNodeIds: [],
        };
      }
    )
  );

  const _updateParentRefs = updateParentRefs.bind(null, parentRefs);

  for (const { name, version, alias, linkedDir } of topParents) {
    const pkg = {
      occurrence: 0,
      alias,
      depth: 0,
      version,
      nodeId: linkedDir,
      parentNodeIds: [],
    };

    _updateParentRefs(name, pkg);
    if (typeof alias === 'string' && alias !== name) {
      _updateParentRefs(alias, pkg);
    }
  }

  return parentRefs;
}

type MissingPeerInfo = {
  range: string;
  optional: boolean;
};

type MissingPeers = Map<string, MissingPeerInfo>;

type PeersCacheItem = {
  depPath: DeferredPromise<DepPath>;
  resolvedPeers: Map<string, NodeId>;
  missingPeers: MissingPeers;
};

type PeersCache = Map<PkgIdWithPatchHash, PeersCacheItem[]>;

type PeersResolution = {
  missingPeers: MissingPeers;
  resolvedPeers: Map<string, NodeId>;
};

// type ResolvePeersContext = {
//   pathsByNodeId: Map<NodeId, DepPath>;
//   pathsByNodeIdPromises: Map<NodeId, DeferredPromise<DepPath>>;
//   depPathsByPkgId?: Map<PkgIdWithPatchHash, Set<DepPath>> | undefined;
// };

type CalculateDepPath = (cycles: string[][]) => Promise<void>;
type FinishingResolutionPromise = Promise<void>;

type ParentPkgInfo = {
  pkgIdWithPatchHash?: PkgIdWithPatchHash | undefined;
  version?: string | undefined;
  depth?: number | undefined;
  occurrence?: number | undefined;
};

type ParentPkgsOfNode = Map<NodeId, Record<string, ParentPkgInfo>>;

async function resolvePeersOfNode(
  currentAlias: string,
  nodeId: NodeId,
  parentParentPkgs: ParentRefs,
  ctx: {
    pathsByNodeId: Map<NodeId, DepPath>;
    pathsByNodeIdPromises: Map<NodeId, DeferredPromise<DepPath>>;
    depPathsByPkgId?: Map<PkgIdWithPatchHash, Set<DepPath>> | undefined;

    allPeerDepNames: Set<string>;
    parentPkgsOfNode: ParentPkgsOfNode;
    parentNodeIds: NodeId[];
    parentDepPathsChain: PkgIdWithPatchHash[];
    dependenciesTree: DependenciesTree;
    depGraph: GenericDependenciesGraph;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    peerDependencyIssues: Pick<PeerDependencyIssues, 'bad' | 'missing'>;
    peersCache: PeersCache;
    purePkgs: Set<PkgIdWithPatchHash>; // pure packages are those that don't rely on externally resolved peers
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
    lockfileDir: string;
    peersSuffixMaxLength: number;
  },
  allResolvedPeers: Map<string, NodeId>
): Promise<
  | (PeersResolution & {
      finishing?: FinishingResolutionPromise | undefined;
      calculateDepPath?: CalculateDepPath | undefined;
    })
  | null
> {
  const node = ctx.dependenciesTree.get(nodeId);

  if (typeof node === 'undefined' || node.depth === -1) {
    return {
      resolvedPeers: new Map<string, NodeId>(),
      missingPeers: new Map<string, MissingPeerInfo>(),
    };
  }

  const resolvedPackage = node.resolvedPackage;

  if (
    typeof resolvedPackage === 'undefined' ||
    !('pkgIdWithPatchHash' in resolvedPackage)
  ) {
    return null;
  }

  if (
    ctx.purePkgs.has(resolvedPackage.pkgIdWithPatchHash) &&
    (ctx.depGraph[resolvedPackage.pkgIdWithPatchHash]?.depth ?? 0) <=
      node.depth &&
    Object.keys(resolvedPackage.peerDependencies).length === 0
  ) {
    ctx.pathsByNodeId.set(
      nodeId,
      resolvedPackage.pkgIdWithPatchHash as unknown as DepPath
    );

    ctx.pathsByNodeIdPromises
      .get(nodeId)
      ?.resolve(resolvedPackage.pkgIdWithPatchHash as unknown as DepPath);

    return {
      resolvedPeers: new Map<string, NodeId>(),
      missingPeers: new Map<string, MissingPeerInfo>(),
    };
  }

  if (typeof node.children === 'function') {
    node.children = node.children();
  }

  const parentNodeIds = [...ctx.parentNodeIds, nodeId];

  const children = node.children;

  let parentPkgs: ParentRefs;

  if (Object.keys(children).length === 0) {
    parentPkgs = parentParentPkgs;
  } else {
    parentPkgs = { ...parentParentPkgs };

    const parentPkgNodes: Array<ParentPkgNode> = [];

    for (const [alias, nodeId] of Object.entries(children)) {
      if (ctx.allPeerDepNames.has(alias)) {
        parentPkgNodes.push({
          alias,
          node: ctx.dependenciesTree.get(nodeId),
          nodeId,
          parentNodeIds,
        });
      }
    }

    const newParentPkgs = toPkgByName(parentPkgNodes);

    const _parentPkgsMatch = parentPkgsMatch.bind(null, ctx.dependenciesTree);

    for (const [newParentPkgName, newParentPkg] of Object.entries(
      newParentPkgs
    )) {
      if (parentPkgs[newParentPkgName]) {
        if (!_parentPkgsMatch(parentPkgs[newParentPkgName], newParentPkg)) {
          newParentPkg.occurrence = parentPkgs[newParentPkgName].occurrence + 1;

          parentPkgs[newParentPkgName] = newParentPkg;
        }
      } else {
        parentPkgs[newParentPkgName] = newParentPkg;
      }
    }
  }

  const hit = findHit(ctx, parentPkgs, resolvedPackage.pkgIdWithPatchHash);

  if (typeof hit !== 'undefined') {
    for (const [
      peerName,
      { range: wantedRange, optional },
    ] of hit.missingPeers.entries()) {
      if (ctx.peerDependencyIssues.missing[peerName] == null) {
        ctx.peerDependencyIssues.missing[peerName] = [];
      }

      const { parents } = getLocationFromParentNodeIds({
        dependenciesTree: ctx.dependenciesTree,
        parentNodeIds,
      });

      ctx.peerDependencyIssues.missing[peerName].push({
        optional,
        parents,
        wantedRange,
      });
    }

    return {
      missingPeers: hit.missingPeers,
      finishing: (async (): Promise<void> => {
        const depPath = await hit.depPath.promise;

        ctx.pathsByNodeId.set(nodeId, depPath);

        const depNode = ctx.depGraph[depPath];

        if (typeof depNode !== 'undefined') {
          depNode.depth = Math.min(depNode.depth, node.depth);
        }
        ctx.pathsByNodeIdPromises.get(nodeId)?.resolve(depPath);
      })(),
      resolvedPeers: hit.resolvedPeers,
    };
  }

  const {
    resolvedPeers: unknownResolvedPeersOfChildren,
    missingPeers: missingPeersOfChildren,
    finishing,
  } = await resolvePeersOfChildren(children, parentPkgs, {
    ...ctx,
    parentNodeIds,
    parentDepPathsChain: ctx.parentDepPathsChain.includes(
      resolvedPackage.pkgIdWithPatchHash
    )
      ? ctx.parentDepPathsChain
      : [...ctx.parentDepPathsChain, resolvedPackage.pkgIdWithPatchHash],
  });

  const { resolvedPeers, missingPeers } =
    Object.keys(resolvedPackage.peerDependencies).length === 0
      ? {
          resolvedPeers: new Map<string, NodeId>(),
          missingPeers: new Map<string, MissingPeerInfo>(),
        }
      : _resolvePeers({
          currentDepth: node.depth,
          dependenciesTree: ctx.dependenciesTree,
          lockfileDir: ctx.lockfileDir,
          nodeId,
          parentPkgs,
          peerDependencyIssues: ctx.peerDependencyIssues,
          resolvedPackage,
          rootDir: ctx.rootDir,
          parentNodeIds,
        });

  for (const [k, v] of resolvedPeers) {
    unknownResolvedPeersOfChildren.set(k, v);
  }

  if (typeof node.resolvedPackage.name === 'string') {
    unknownResolvedPeersOfChildren.delete(node.resolvedPackage.name);
  }

  const allMissingPeers = new Map<string, MissingPeerInfo>();

  for (const [peer, range] of missingPeersOfChildren.entries()) {
    allMissingPeers.set(peer, range);
  }

  for (const [peer, range] of missingPeers.entries()) {
    allMissingPeers.set(peer, range);
  }

  let cache: PeersCacheItem | undefined;

  const isPure =
    unknownResolvedPeersOfChildren.size === 0 && allMissingPeers.size === 0;

  if (isPure) {
    ctx.purePkgs.add(resolvedPackage.pkgIdWithPatchHash);
  } else {
    cache = {
      missingPeers: allMissingPeers,
      depPath: pDefer(),
      resolvedPeers: unknownResolvedPeersOfChildren,
    };

    if (ctx.peersCache.has(resolvedPackage.pkgIdWithPatchHash)) {
      ctx.peersCache.get(resolvedPackage.pkgIdWithPatchHash)?.push(cache);
    } else {
      ctx.peersCache.set(resolvedPackage.pkgIdWithPatchHash, [cache]);
    }
  }

  let calculateDepPathIfNeeded: CalculateDepPath | undefined;

  if (unknownResolvedPeersOfChildren.size === 0) {
    addDepPathToGraph(
      node,
      resolvedPackage.pkgIdWithPatchHash as unknown as DepPath,
      nodeId,
      cache,
      ctx,
      resolvedPackage,
      allResolvedPeers,
      missingPeersOfChildren,
      resolvedPeers,
      children,
      isPure
    );
  } else {
    const peerIds: PeerId[] = [];

    const pendingPeers: PendingPeer[] = [];

    for (const [
      alias,
      peerNodeId,
    ] of unknownResolvedPeersOfChildren.entries()) {
      if (typeof peerNodeId === 'string' && peerNodeId.startsWith('link:')) {
        const linkedDir = peerNodeId.slice(5);

        peerIds.push({
          name: alias,
          version: filenamify(linkedDir, { replacement: '+' }),
        });

        continue;
      }

      const peerDepPath = ctx.pathsByNodeId.get(peerNodeId);

      if (peerDepPath) {
        peerIds.push(peerDepPath);

        continue;
      }

      pendingPeers.push({ alias, nodeId: peerNodeId });
    }

    if (pendingPeers.length === 0) {
      const peersDirSuffix = createPeersDirSuffix(
        peerIds,
        ctx.peersSuffixMaxLength
      );

      addDepPathToGraph(
        node,
        `${resolvedPackage.pkgIdWithPatchHash}${peersDirSuffix}` as DepPath,
        nodeId,
        cache,
        ctx,
        resolvedPackage,
        allResolvedPeers,
        missingPeersOfChildren,
        resolvedPeers,
        children,
        isPure
      );
    } else {
      calculateDepPathIfNeeded = calculateDepPath.bind(
        null,
        node,
        peerIds,
        pendingPeers,
        resolvedPackage
      );
    }
  }

  return {
    resolvedPeers: unknownResolvedPeersOfChildren,
    missingPeers: allMissingPeers,
    calculateDepPath: calculateDepPathIfNeeded,
    finishing,
  };

  async function calculateDepPath(
    node: DependenciesTreeNode,
    peerIds: PeerId[],
    pendingPeerNodes: PendingPeer[],
    resolvedPackage: ResolvedPackage & {
      name: string;
      version: string;
    },
    cycles: string[][]
  ): Promise<void> {
    const cyclicPeerAliases = new Set();

    for (const cycle of cycles) {
      if (cycle.includes(currentAlias)) {
        for (const peerAlias of cycle) {
          cyclicPeerAliases.add(peerAlias);
        }
      }
    }

    const peersDirSuffix = createPeersDirSuffix(
      [
        ...peerIds,
        ...(
          await Promise.all(
            pendingPeerNodes.map(
              async (pendingPeer: PendingPeer): Promise<string | undefined> => {
                if (cyclicPeerAliases.has(pendingPeer.alias)) {
                  const resolvedPackage = ctx.dependenciesTree.get(
                    pendingPeer.nodeId
                  )?.resolvedPackage;

                  if (typeof resolvedPackage !== 'undefined') {
                    const { name, version } = resolvedPackage;

                    const id = `${name}@${version}`;

                    ctx.pathsByNodeIdPromises
                      .get(pendingPeer.nodeId)
                      ?.resolve(id as DepPath);

                    return id;
                  }
                }

                return ctx.pathsByNodeIdPromises.get(pendingPeer.nodeId)
                  ?.promise;
              }
            )
          )
        ).filter(Boolean),
      ],
      ctx.peersSuffixMaxLength
    );

    addDepPathToGraph(
      node,
      `${resolvedPackage.pkgIdWithPatchHash}${peersDirSuffix}` as DepPath,
      nodeId,
      cache,
      ctx,
      resolvedPackage,
      allResolvedPeers,
      missingPeersOfChildren,
      resolvedPeers,
      children,
      isPure
    );
  }
}

function addDepPathToGraph(
  node: DependenciesTreeNode,
  depPath: DepPath,
  nodeId: NodeId,
  cache: PeersCacheItem | undefined,
  ctx: {
    pathsByNodeId: Map<NodeId, DepPath>;
    pathsByNodeIdPromises: Map<NodeId, DeferredPromise<DepPath>>;
    depPathsByPkgId?: Map<PkgIdWithPatchHash, Set<DepPath>> | undefined;
    allPeerDepNames: Set<string>;
    parentPkgsOfNode: ParentPkgsOfNode;
    parentNodeIds: NodeId[];
    parentDepPathsChain: PkgIdWithPatchHash[];
    dependenciesTree: DependenciesTree;
    depGraph: GenericDependenciesGraph;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    peerDependencyIssues: Pick<PeerDependencyIssues, 'bad' | 'missing'>;
    peersCache: PeersCache;
    purePkgs: Set<PkgIdWithPatchHash>;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
    lockfileDir: string;
    peersSuffixMaxLength: number;
  },
  resolvedPackage: ResolvedPackage,

  allResolvedPeers: Map<string, NodeId>,
  missingPeersOfChildren: MissingPeers,
  resolvedPeers: Map<string, NodeId>,
  children: {
    [alias: string]: NodeId;
  },
  isPure: boolean
): void {
  cache?.depPath.resolve(depPath);

  ctx.pathsByNodeId.set(nodeId, depPath);

  ctx.pathsByNodeIdPromises.get(nodeId)?.resolve(depPath);

  if (typeof ctx.depPathsByPkgId !== 'undefined') {
    if (ctx.depPathsByPkgId.has(resolvedPackage.pkgIdWithPatchHash) === true) {
      ctx.depPathsByPkgId.get(resolvedPackage.pkgIdWithPatchHash)?.add(depPath);
    } else {
      ctx.depPathsByPkgId.set(
        resolvedPackage.pkgIdWithPatchHash,
        new Set([depPath])
      );
    }
  }

  const peerDependencies = { ...resolvedPackage.peerDependencies };

  if (!ctx.depGraph[depPath] || ctx.depGraph[depPath].depth > node.depth) {
    const modules = path.join(
      ctx.virtualStoreDir,
      depPathToFilename(depPath, ctx.virtualStoreDirMaxLength),
      'node_modules'
    );

    const dir = path.join(modules, resolvedPackage.name);

    const transitivePeerDependencies = new Set<string>();

    for (const unknownPeer of allResolvedPeers.keys()) {
      if (!peerDependencies[unknownPeer]) {
        transitivePeerDependencies.add(unknownPeer);
      }
    }

    for (const unknownPeer of missingPeersOfChildren.keys()) {
      if (!peerDependencies[unknownPeer]) {
        transitivePeerDependencies.add(unknownPeer);
      }
    }

    if ('id' in node.resolvedPackage) {
      ctx.depGraph[depPath] = {
        ...node.resolvedPackage,
        isBuilt: false,
        childrenNodeIds: Object.assign(
          getPreviouslyResolvedChildren(
            ctx,
            node.resolvedPackage.pkgIdWithPatchHash
          ),
          children,
          Object.fromEntries(resolvedPeers.entries())
        ),
        depPath,
        depth: node.depth,
        dir,
        installable: node.installable ?? false,
        isPure,
        modules,
        peerDependencies,
        transitivePeerDependencies,
        resolvedPeerNames: new Set(allResolvedPeers.keys()),
      };
    }
  }
}

type PendingPeer = {
  alias: string;
  nodeId: NodeId;
};

function parentPkgsMatch(
  dependenciesTree: DependenciesTree,
  currentParentPkg: ParentRef,
  newParentPkg: ParentRef
): boolean {
  if (
    currentParentPkg.version !== newParentPkg.version ||
    currentParentPkg.alias !== newParentPkg.alias
  ) {
    return false;
  }

  const currentParentResolvedPkg =
    currentParentPkg.nodeId &&
    dependenciesTree.get(currentParentPkg.nodeId)?.resolvedPackage;

  if (currentParentResolvedPkg == null) {
    return true;
  }

  const newParentResolvedPkg =
    newParentPkg.nodeId &&
    dependenciesTree.get(newParentPkg.nodeId)?.resolvedPackage;

  if (newParentResolvedPkg == null) {
    return true;
  }

  return currentParentResolvedPkg.name === newParentResolvedPkg.name;
}

function findHit(
  ctx: {
    parentPkgsOfNode: ParentPkgsOfNode;
    peersCache: PeersCache;
    purePkgs: Set<PkgIdWithPatchHash>;
    pathsByNodeId: Map<NodeId, DepPath>;
    dependenciesTree: DependenciesTree;
  },
  parentPkgs: ParentRefs,
  pkgIdWithPatchHash: PkgIdWithPatchHash
): PeersCacheItem | undefined {
  const cacheItems = ctx.peersCache.get(pkgIdWithPatchHash);

  if (typeof cacheItems === 'undefined') {
    return undefined;
  }

  return cacheItems.find((cache: PeersCacheItem): boolean => {
    for (const [name, cachedNodeId] of cache.resolvedPeers) {
      const parentPkgNodeId = parentPkgs[name]?.nodeId;

      if (Boolean(parentPkgNodeId) !== Boolean(cachedNodeId)) {
        return false;
      }

      if (parentPkgNodeId === cachedNodeId) {
        continue;
      }

      if (!parentPkgNodeId) {
        return false;
      }

      if (
        ctx.pathsByNodeId.has(cachedNodeId) &&
        ctx.pathsByNodeId.get(cachedNodeId) ===
          ctx.pathsByNodeId.get(parentPkgNodeId)
      ) {
        continue;
      }

      if (
        !ctx.dependenciesTree.has(parentPkgNodeId) &&
        typeof parentPkgNodeId === 'string' &&
        parentPkgNodeId.startsWith('link:')
      ) {
        return false;
      }

      const parent = ctx.dependenciesTree.get(parentPkgNodeId);

      const cached = ctx.dependenciesTree.get(cachedNodeId);

      if (typeof parent === 'undefined' || typeof cached === 'undefined') {
        return false;
      }

      if (
        'pkgIdWithPatchHash' in parent.resolvedPackage &&
        'pkgIdWithPatchHash' in cached.resolvedPackage
      ) {
        const parentPkgId = parent.resolvedPackage.pkgIdWithPatchHash;

        const cachedPkgId = cached.resolvedPackage.pkgIdWithPatchHash;

        if (parentPkgId !== cachedPkgId) {
          return false;
        }

        if (
          !ctx.purePkgs.has(parentPkgId) &&
          !parentPackagesMatch(ctx, cachedNodeId, parentPkgNodeId)
        ) {
          return false;
        }
      }

      return false;
    }

    for (const missingPeer of cache.missingPeers.keys()) {
      if (parentPkgs[missingPeer]) return false;
    }

    return true;
  });
}

function parentPackagesMatch(
  ctx: {
    parentPkgsOfNode: ParentPkgsOfNode;
    purePkgs: Set<PkgIdWithPatchHash>;
  },
  cachedNodeId: NodeId,
  checkedNodeId: NodeId
): boolean {
  const cachedParentPkgs = ctx.parentPkgsOfNode.get(cachedNodeId);

  if (!cachedParentPkgs) {
    return false;
  }

  const checkedParentPkgs = ctx.parentPkgsOfNode.get(checkedNodeId);

  if (!checkedParentPkgs) {
    return false;
  }

  if (
    Object.keys(cachedParentPkgs).length !==
    Object.keys(checkedParentPkgs).length
  ) {
    return false;
  }

  const maxDepth = Object.values(checkedParentPkgs).reduce(
    (maxDepth, { depth }) => Math.max(depth ?? 0, maxDepth),
    0
  );

  const peerDepsAreNotShadowed =
    parentPkgsHaveSingleOccurrence(cachedParentPkgs) &&
    parentPkgsHaveSingleOccurrence(checkedParentPkgs);

  return Object.entries(cachedParentPkgs).every(
    ([name, { version, pkgIdWithPatchHash }]: [
      string,
      ParentPkgInfo,
    ]): boolean => {
      const pp = checkedParentPkgs[name];

      if (typeof pp === 'undefined') {
        return false;
      }

      if (typeof version === 'string' && typeof pp.version === 'string') {
        return version === pp.version;
      }

      return (
        pkgIdWithPatchHash != null &&
        pkgIdWithPatchHash === pp.pkgIdWithPatchHash &&
        (peerDepsAreNotShadowed ||
          // Peer dependencies that appear last we can consider valid.
          // If they do depend on other peer dependencies then they must be those that we will check further.
          pp.depth === maxDepth ||
          ctx.purePkgs.has(pkgIdWithPatchHash))
      );
    }
  );
}

function parentPkgsHaveSingleOccurrence(
  parentPkgs: Record<string, ParentPkgInfo>
): boolean {
  return Object.values(parentPkgs).every(
    ({ occurrence }: ParentPkgInfo): boolean => {
      return occurrence === 0 || occurrence == null;
    }
  );
}

// When a package has itself in the subdependencies, so there's a cycle,
// pnpm will break the cycle, when it first repeats itself.
// However, when the cycle is broken up, the last repeated package is removed
// from the dependencies of the parent package.
// So we need to merge all the children of all the parent packages with same ID as the resolved package.
// This way we get all the children that were removed, when ending cycles.
function getPreviouslyResolvedChildren(
  {
    parentNodeIds,
    parentDepPathsChain,
    dependenciesTree,
  }: {
    parentNodeIds: NodeId[];
    parentDepPathsChain: PkgIdWithPatchHash[];
    dependenciesTree: DependenciesTree;
  },
  currentDepPath?: PkgIdWithPatchHash | undefined
): ChildrenMap {
  const allChildren: ChildrenMap = {};

  if (!currentDepPath || !parentDepPathsChain.includes(currentDepPath))
    return allChildren;

  for (let i = parentNodeIds.length - 1; i >= 0; i--) {
    const id = parentNodeIds[i];

    if (typeof id === 'undefined') {
      continue;
    }

    const parentNode = dependenciesTree.get(id);

    if (typeof parentNode === 'undefined') {
      continue;
    }

    if (!('pkgIdWithPatchHash' in parentNode.resolvedPackage)) {
      continue;
    }

    if (parentNode.resolvedPackage.pkgIdWithPatchHash === currentDepPath) {
      if (typeof parentNode.children === 'function') {
        parentNode.children = parentNode.children();
      }

      Object.assign<ChildrenMap, ChildrenMap>(allChildren, parentNode.children);
    }
  }

  return allChildren;
}

async function resolvePeersOfChildren(
  children: {
    [alias: string]: NodeId;
  },
  parentPkgs: ParentRefs,
  ctx: {
    pathsByNodeId: Map<NodeId, DepPath>;
    pathsByNodeIdPromises: Map<NodeId, DeferredPromise<DepPath>>;
    depPathsByPkgId?: Map<PkgIdWithPatchHash, Set<DepPath>> | undefined;

    allPeerDepNames: Set<string>;
    parentPkgsOfNode: ParentPkgsOfNode;
    parentNodeIds: NodeId[];
    parentDepPathsChain: PkgIdWithPatchHash[];
    peerDependencyIssues: Pick<PeerDependencyIssues, 'bad' | 'missing'>;
    peersCache: PeersCache;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    purePkgs: Set<PkgIdWithPatchHash>;
    depGraph: GenericDependenciesGraph;
    dependenciesTree: DependenciesTree;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
    lockfileDir: string;
    peersSuffixMaxLength: number;
  }
): Promise<PeersResolution & { finishing: Promise<void> }> {
  const allResolvedPeers = new Map<string, NodeId>();

  const allMissingPeers = new Map<string, MissingPeerInfo>();

  // Partition children based on whether they're repeated in parentPkgs.
  // This impacts the efficiency of graph traversal and prevents potential out-of-memory errors.
  // We check repeated first as the peers resolution of those probably are cached already.
  const [repeated, notRepeated] = partition.default(
    ([alias]: [string, NodeId]): boolean => {
      return parentPkgs[alias] != null;
    },
    Object.entries(children)
  );

  const nodeIds = Array.from(
    new Set(
      [...repeated, ...notRepeated].map(
        ([_, nodeId]: [string, NodeId]): NodeId => {
          return nodeId;
        }
      )
    )
  );

  const aliasByNodeId = Object.fromEntries(
    Object.entries(children).map(
      ([alias, nodeId]: [string, NodeId]): [NodeId, string] => {
        return [nodeId, alias];
      }
    )
  );

  for (const nodeId of nodeIds) {
    if (!ctx.pathsByNodeIdPromises.has(nodeId)) {
      ctx.pathsByNodeIdPromises.set(nodeId, pDefer());
    }
  }

  // Resolving non-repeated nodes before repeated nodes proved to be slightly faster.
  const calculateDepPaths: CalculateDepPath[] = [];

  const graph = [];

  const finishingList: FinishingResolutionPromise[] = [];

  const parentDepPaths: Record<string, ParentPkgInfo> = {};

  for (const [name, parentPkg] of Object.entries(parentPkgs)) {
    if (!ctx.allPeerDepNames.has(name)) continue;

    if (
      parentPkg.nodeId &&
      (typeof parentPkg.nodeId === 'number' ||
        !parentPkg.nodeId.startsWith('link:'))
    ) {
      const dn = ctx.dependenciesTree.get(parentPkg.nodeId);

      if (typeof dn !== 'undefined') {
        parentDepPaths[name] = {
          pkgIdWithPatchHash:
            'pkgIdWithPatchHash' in dn.resolvedPackage
              ? dn.resolvedPackage.pkgIdWithPatchHash
              : undefined,
          depth: parentPkg.depth,
          occurrence: parentPkg.occurrence,
        };
      }
    } else {
      parentDepPaths[name] = { version: parentPkg.version };
    }
  }

  for (const childNodeId of nodeIds) {
    ctx.parentPkgsOfNode.set(childNodeId, parentDepPaths);
  }

  for (const childNodeId of nodeIds) {
    const currentAlias = aliasByNodeId[childNodeId];

    if (typeof currentAlias === 'undefined') {
      continue;
    }

    const node = await resolvePeersOfNode(
      currentAlias,
      childNodeId,
      parentPkgs,
      ctx,
      allResolvedPeers
    );

    if (node == null) {
      continue;
    }

    const { resolvedPeers, missingPeers, calculateDepPath, finishing } = node;

    if (finishing) {
      finishingList.push(finishing);
    }

    if (calculateDepPath) {
      calculateDepPaths.push(calculateDepPath);
    }

    const edges: string[] = [];

    for (const [peerName, peerNodeId] of resolvedPeers) {
      allResolvedPeers.set(peerName, peerNodeId);

      edges.push(peerName);
    }

    graph.push([currentAlias, edges]);

    for (const [missingPeer, range] of missingPeers.entries()) {
      allMissingPeers.set(missingPeer, range);
    }
  }

  if (calculateDepPaths.length) {
    const { cycles } = analyzeGraph(graph as unknown as Graph) as unknown as {
      cycles: string[][];
    };

    finishingList.push(
      ...calculateDepPaths.map((calculateDepPath): Promise<void> => {
        return calculateDepPath(cycles);
      })
    );
  }

  const finishing = Promise.all(finishingList).then(() => {});

  const unknownResolvedPeersOfChildren = new Map<string, NodeId>();

  for (const [alias, v] of allResolvedPeers) {
    if (!children[alias]) {
      unknownResolvedPeersOfChildren.set(alias, v);
    }
  }

  return {
    resolvedPeers: unknownResolvedPeersOfChildren,
    missingPeers: allMissingPeers,
    finishing,
  };
}

function _resolvePeers(ctx: {
  currentDepth: number;
  lockfileDir: string;
  nodeId: NodeId;
  parentPkgs: ParentRefs;
  parentNodeIds: NodeId[];
  resolvedPackage: PartialResolvedPackage;
  dependenciesTree: DependenciesTree;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  peerDependencyIssues: Pick<PeerDependencyIssues, 'bad' | 'missing'>;
}): PeersResolution {
  const resolvedPeers = new Map<string, NodeId>();

  const missingPeers = new Map<string, MissingPeerInfo>();

  for (const [peerName, { version, optional }] of Object.entries(
    ctx.resolvedPackage.peerDependencies
  )) {
    const peerVersionRange = version.replace(/^workspace:/, '');

    const resolved = ctx.parentPkgs[peerName];

    const optionalPeer = optional === true;

    if (!resolved) {
      missingPeers.set(peerName, { range: version, optional: optionalPeer });

      const location = getLocationFromParentNodeIds(ctx);

      if (!ctx.peerDependencyIssues.missing[peerName]) {
        ctx.peerDependencyIssues.missing[peerName] = [];
      }

      ctx.peerDependencyIssues.missing[peerName].push({
        parents: location.parents,
        optional: optionalPeer,
        wantedRange: peerVersionRange,
      });

      continue;
    }

    if (
      semverUtils.satisfiesWithPrereleases(
        resolved.version,
        peerVersionRange,
        true
      ) !== true
    ) {
      const location = getLocationFromParentNodeIds(ctx);

      if (!ctx.peerDependencyIssues.bad[peerName]) {
        ctx.peerDependencyIssues.bad[peerName] = [];
      }

      const peerLocation =
        resolved.nodeId == null
          ? []
          : getLocationFromParentNodeIds({
              dependenciesTree: ctx.dependenciesTree,
              parentNodeIds: resolved.parentNodeIds,
            }).parents;

      ctx.peerDependencyIssues.bad[peerName].push({
        foundVersion: resolved.version,
        resolvedFrom: peerLocation,
        parents: location.parents,
        optional: optionalPeer,
        wantedRange: peerVersionRange,
      });
    }

    if (resolved.nodeId) {
      resolvedPeers.set(peerName, resolved.nodeId);
    }
  }

  return { resolvedPeers, missingPeers };
}

type Location = {
  projectId: string;
  parents: ParentPackages;
};

function getLocationFromParentNodeIds({
  dependenciesTree,
  parentNodeIds,
}: {
  dependenciesTree: DependenciesTree;
  parentNodeIds: NodeId[];
}): Location {
  const parents = parentNodeIds.map(
    (nid: NodeId): Pick<ResolvedPackage, 'name' | 'version'> => {
      return pick.default(
        ['name', 'version'],
        dependenciesTree.get(nid)?.resolvedPackage as ResolvedPackage
      );
    }
  );

  return {
    projectId: '.',
    parents,
  };
}

type ParentRefs = {
  [name: string]: ParentRef;
};

type ParentRef = {
  version: string;
  depth: number;
  // this is null only for already installed top dependencies
  nodeId?: NodeId | undefined;
  alias?: string | undefined;
  occurrence: number;
  parentNodeIds: NodeId[];
};

type ParentPkgNode = {
  alias: string;
  nodeId: NodeId;
  node?: DependenciesTreeNode | undefined;
  parentNodeIds: NodeId[];
};

function toPkgByName(nodes: Array<ParentPkgNode>): ParentRefs {
  const pkgsByName: ParentRefs = {};

  const _updateParentRefs = updateParentRefs.bind(null, pkgsByName);

  for (const { alias, node, nodeId, parentNodeIds } of nodes) {
    if (
      typeof node === 'undefined' ||
      typeof node.resolvedPackage === 'undefined'
    ) {
      continue;
    }

    const pkg = {
      alias,
      depth: node.depth,
      nodeId,
      version: node.resolvedPackage.version,
      occurrence: 0,
      parentNodeIds,
    };

    _updateParentRefs(alias, pkg);

    if (alias !== node.resolvedPackage.name) {
      _updateParentRefs(node.resolvedPackage.name, pkg);
    }
  }

  return pkgsByName;
}

function updateParentRefs(
  parentRefs: ParentRefs,
  newAlias: string,
  pkg: ParentRef
): void {
  const existing = parentRefs[newAlias];

  if (existing) {
    const existingHasAlias =
      existing.alias != null && existing.alias !== newAlias;

    if (!existingHasAlias) {
      return;
    }

    const newHasAlias = pkg.alias != null && pkg.alias !== newAlias;

    if (newHasAlias && semver.gte(existing.version, pkg.version)) {
      return;
    }
  }

  parentRefs[newAlias] = pkg;
}
