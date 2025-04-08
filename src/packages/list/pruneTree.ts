import * as crypto from '../crypto.polyfill/index.ts';
import type {
  DependenciesHierarchy,
  PackageNode,
} from '../reviewing.dependencies-hierarchy/index.ts';
import type { PackageDependencyHierarchy } from './types.ts';

export function pruneDependenciesTrees(
  trees: PackageDependencyHierarchy[] | null,
  limit: number
): PackageDependencyHierarchy[] {
  if (trees === null) {
    return [];
  }

  return trees.map(
    (
      tree: PackageDependencyHierarchy
    ): {
      dependencies: PackageNode[];
      name?: string | undefined;
      version?: string | undefined;
      path: string;
      private?: boolean | undefined;
      devDependencies?: PackageNode[] | undefined;
      optionalDependencies?: PackageNode[] | undefined;
      unsavedDependencies?: PackageNode[] | undefined;
    } => {
      const endLeafPaths: PackageNode[][] = [];

      const visitedNodes = new Set<string>();

      function findEndLeaves(node: PackageNode, path: PackageNode[]): void {
        if (node.circular) {
          return;
        }

        const nodeId = `${node.name}@${node.version}`;

        if (visitedNodes.has(nodeId)) {
          return;
        }

        visitedNodes.add(nodeId);

        const newPath = [...path, node];

        if (!node.dependencies || node.dependencies.length === 0) {
          endLeafPaths.push(newPath);

          if (endLeafPaths.length >= limit) {
            return;
          }
        }

        for (const child of node.dependencies ?? []) {
          findEndLeaves(child, newPath);

          if (endLeafPaths.length >= limit) {
            return;
          }
        }

        visitedNodes.delete(nodeId);
      }

      if (tree.dependencies) {
        for (const node of tree.dependencies) {
          findEndLeaves(node, []);
        }
      }

      const firstNPaths = endLeafPaths.slice(0, limit);

      const map = new Map<string, PackageNode>();

      const newTree: DependenciesHierarchy = { dependencies: [] };

      for (const path of firstNPaths) {
        let currentDependencies: PackageNode[] = newTree.dependencies ?? [];

        let pathSoFar = '';

        for (const node of path) {
          pathSoFar += `${node.name}@${node.version},`;

          const id = crypto.hash('sha256', pathSoFar, 'hex');

          let existingNode = map.get(id);

          if (!existingNode) {
            existingNode = { ...node, dependencies: [] };

            currentDependencies.push(existingNode);

            map.set(id, existingNode);
          }

          currentDependencies = existingNode.dependencies ?? [];
        }
      }

      return {
        ...tree,
        dependencies: newTree.dependencies ?? [],
      };
    }
  );
}
