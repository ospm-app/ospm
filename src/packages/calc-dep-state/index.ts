import { ENGINE_NAME } from '../constants/index.ts';
import {
  getPkgIdWithPatchHash,
  refToRelative,
} from '../dependency-path/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { DepPath, PkgIdWithPatchHash } from '../types/index.ts';
import { hashObjectWithoutSorting } from '../crypto.object-hasher/index.ts';
import { sortDirectKeys } from '../object.key-sorting/index.ts';

export type DepsGraph<T extends string> = Record<T, DepsGraphNode<T>>;

export type DepsGraphNode<T extends string> = {
  children: { [alias: string]: T };
  pkgIdWithPatchHash: PkgIdWithPatchHash;
};

export type DepsStateCache = {
  [depPath: string]: DepStateObj;
};

export type DepStateObj = {
  [depPath: string]: DepStateObj;
};

export function calcDepState<T extends string>(
  depsGraph: DepsGraph<T>,
  cache: DepsStateCache,
  depPath: string,
  opts: {
    patchFileHash?: string | undefined;
    isBuilt: boolean;
  }
): string {
  let result = ENGINE_NAME;

  if (opts.isBuilt === true) {
    const depStateObj = calcDepStateObj(depPath, depsGraph, cache, new Set());

    result += `;deps=${hashObjectWithoutSorting(depStateObj)}`;
  }

  if (typeof opts.patchFileHash === 'string') {
    result += `;patch=${opts.patchFileHash}`;
  }

  return result;
}

function calcDepStateObj<T extends string>(
  depPath: T,
  depsGraph: DepsGraph<T>,
  cache: DepsStateCache,
  parents: Set<PkgIdWithPatchHash>
): DepStateObj {
  if (cache[depPath]) {
    return cache[depPath];
  }

  const node = depsGraph[depPath];

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
  if (!node) {
    return {};
  }

  const nextParents = new Set([
    ...Array.from(parents),
    node.pkgIdWithPatchHash,
  ]);

  const state: DepStateObj = {};

  for (const childId of Object.values(node.children)) {
    const child = depsGraph[childId];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
    if (!child) continue;

    if (parents.has(child.pkgIdWithPatchHash)) {
      state[child.pkgIdWithPatchHash] = {};

      continue;
    }

    state[child.pkgIdWithPatchHash] = calcDepStateObj(
      childId,
      depsGraph,
      cache,
      nextParents
    );
  }

  cache[depPath] = sortDirectKeys(state);

  return cache[depPath];
}

export function lockfileToDepGraph(
  lockfile: LockfileObject
): DepsGraph<DepPath> {
  const graph: DepsGraph<DepPath> = {};
  if (typeof lockfile.packages !== 'undefined') {
    for (const [depPath, pkgSnapshot] of Object.entries(lockfile.packages)) {
      const children = lockfileDepsToGraphChildren({
        ...pkgSnapshot.dependencies,
        ...pkgSnapshot.optionalDependencies,
      });

      graph[depPath as DepPath] = {
        children,
        pkgIdWithPatchHash: getPkgIdWithPatchHash(depPath as DepPath),
      };
    }
  }

  return graph;
}

function lockfileDepsToGraphChildren(
  deps: Record<string, string>
): Record<string, DepPath> {
  const children: Record<string, DepPath> = {};

  for (const [alias, reference] of Object.entries(deps)) {
    const depPath = refToRelative(reference, alias);

    if (depPath) {
      children[alias] = depPath;
    }
  }

  return children;
}
