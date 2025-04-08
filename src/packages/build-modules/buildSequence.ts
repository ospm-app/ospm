import { graphSequencer, type Groups } from '../deps.graph-sequencer/index.ts';
import type { PatchInfo } from '../patching.types/index.ts';
import type {
  PkgIdWithPatchHash,
  DepPath,
  PackageManifest,
} from '../types/index.ts';
import filter from 'ramda/src/filter';

export type DependenciesGraphNode<T extends string> = {
  children: Record<string, T>;
  depPath: DepPath;
  pkgIdWithPatchHash: PkgIdWithPatchHash;
  name: string;
  dir: string;
  fetchingBundledManifest?:
    | (() => Promise<PackageManifest | undefined>)
    | undefined;
  filesIndexFile?: string | undefined;
  hasBin: boolean;
  hasBundledDependencies: boolean;
  installable?: boolean | undefined;
  isBuilt: boolean;
  optional?: boolean | undefined;
  optionalDependencies: Set<string>;

  // this is a dirty workaround added in https://github.com/pnpm/pnpm/pull/4898
  requiresBuild?: boolean | undefined; // any
  patch?: PatchInfo | undefined;
};

export type DependenciesGraph<T extends string> = Record<
  T,
  DependenciesGraphNode<T>
>;

export function buildSequence<T extends string>(
  depGraph: Record<
    string,
    Pick<DependenciesGraphNode<T>, 'children' | 'requiresBuild'>
  >,
  rootDepPaths: T[]
): Groups<string> {
  const nodesToBuild = new Set<string>();

  getSubgraphToBuild(depGraph, rootDepPaths, nodesToBuild, new Set<T>());
  const onlyFromBuildGraph = filter.default((depPath: T): boolean => {
    return nodesToBuild.has(depPath);
  });

  const nodesToBuildArray = Array.from(nodesToBuild);

  const graph = new Map(
    nodesToBuildArray.map((depPath: string): [string, string[]] => {
      return [
        depPath,
        onlyFromBuildGraph(Object.values(depGraph[depPath]?.children ?? {})),
      ];
    })
  );

  const graphSequencerResult = graphSequencer(graph, nodesToBuildArray);

  return graphSequencerResult.chunks;
}

function getSubgraphToBuild<T extends string>(
  graph: Record<
    string,
    Pick<DependenciesGraphNode<T>, 'children' | 'requiresBuild' | 'patch'>
  >,
  entryNodes: T[],
  nodesToBuild: Set<T>,
  walked: Set<T>
): boolean {
  let currentShouldBeBuilt = false;

  for (const depPath of entryNodes) {
    const node = graph[depPath];

    // packages that are already in node_modules are skipped
    if (!node) {
      continue;
    }

    if (walked.has(depPath)) {
      continue;
    }

    walked.add(depPath);

    const childShouldBeBuilt =
      getSubgraphToBuild(
        graph,
        Object.values(node.children),
        nodesToBuild,
        walked
      ) ||
      node.requiresBuild === true ||
      node.patch != null;

    if (childShouldBeBuilt) {
      nodesToBuild.add(depPath);
      currentShouldBeBuilt = true;
    }
  }

  return currentShouldBeBuilt;
}
