import path from 'node:path';
import normalize from 'normalize-path';
import type { PkgResolutionId, DepPath } from '../types/index.ts';
import type {
  ResolvedDirectDependency,
  ResolvedImporters,
} from './resolveDependencyTree.ts';
import type { NodeId } from './nextNodeId.ts';
import type { LinkedDependency } from './resolveDependencies.ts';
import type {
  GenericDependenciesGraphWithResolvedChildren,
  DependenciesByProjectId,
  ProjectToResolve,
} from './resolvePeers.ts';

export interface DedupeInjectedDepsOptions {
  depGraph: GenericDependenciesGraphWithResolvedChildren;
  dependenciesByProjectId: DependenciesByProjectId;
  lockfileDir: string;
  pathsByNodeId: Map<NodeId, DepPath>;
  projects: ProjectToResolve[];
  resolvedImporters: ResolvedImporters;
}

export function dedupeInjectedDeps(opts: DedupeInjectedDepsOptions): void {
  const injectedDepsByProjects = getInjectedDepsByProjects(opts);

  const dedupeMap = getDedupeMap(injectedDepsByProjects, opts);

  applyDedupeMap(dedupeMap, opts);
}

type InjectedDepsByProjects = Map<
  string,
  Map<string, { depPath: DepPath; id: string }>
>;

function getInjectedDepsByProjects(
  opts: Pick<
    DedupeInjectedDepsOptions,
    'projects' | 'pathsByNodeId' | 'depGraph'
  >
): InjectedDepsByProjects {
  const injectedDepsByProjects = new Map<
    string,
    Map<string, { depPath: DepPath; id: string }>
  >();

  for (const project of opts.projects) {
    for (const [alias, nodeId] of project.directNodeIdsByAlias.entries()) {
      const depPath = opts.pathsByNodeId.get(nodeId);

      if (typeof depPath !== 'string') {
        continue;
      }

      const dg = opts.depGraph[depPath];

      if (typeof dg === 'undefined') {
        continue;
      }

      if (dg.id.startsWith('file:') !== true) {
        continue;
      }

      const id = dg.id.substring(5);

      if (opts.projects.some((project) => project.id === id)) {
        if (!injectedDepsByProjects.has(project.id)) {
          injectedDepsByProjects.set(project.id, new Map());
        }

        injectedDepsByProjects.get(project.id)?.set(alias, { depPath, id });
      }
    }
  }

  return injectedDepsByProjects;
}

type DedupeMap = Map<string, Map<string, string>>;

function getDedupeMap(
  injectedDepsByProjects: InjectedDepsByProjects,
  opts: Pick<DedupeInjectedDepsOptions, 'depGraph' | 'dependenciesByProjectId'>
): DedupeMap {
  const toDedupe = new Map<string, Map<string, string>>();

  for (const [id, deps] of injectedDepsByProjects.entries()) {
    const dedupedInjectedDeps = new Map<string, string>();

    for (const [alias, dep] of deps.entries()) {
      // Check for subgroup not equal.
      // The injected project in the workspace may have dev deps
      const isSubset = Object.entries(
        opts.depGraph[dep.depPath]?.children ?? {}
      ).every(([alias, depPath]: [string, DepPath]): boolean => {
        return opts.dependenciesByProjectId[dep.id]?.get(alias) === depPath;
      });

      if (isSubset) {
        dedupedInjectedDeps.set(alias, dep.id);
      }
    }

    toDedupe.set(id, dedupedInjectedDeps);
  }

  return toDedupe;
}

function applyDedupeMap(
  dedupeMap: DedupeMap,
  opts: Pick<
    DedupeInjectedDepsOptions,
    'dependenciesByProjectId' | 'resolvedImporters' | 'lockfileDir'
  >
): void {
  for (const [id, aliases] of dedupeMap.entries()) {
    for (const [alias, dedupedProjectId] of aliases.entries()) {
      opts.dependenciesByProjectId[id]?.delete(alias);

      const index = opts.resolvedImporters[id]?.directDependencies.findIndex(
        (dep) => dep.alias === alias
      );

      if (typeof index === 'undefined') {
        continue;
      }

      const prev = opts.resolvedImporters[id]?.directDependencies[index];

      if (typeof prev === 'undefined') {
        continue;
      }

      const linkedDep: LinkedDependency & ResolvedDirectDependency = {
        ...prev,
        isLinkedDependency: true,
        pkgId:
          `link:${normalize(path.relative(id, dedupedProjectId))}` as PkgResolutionId,
        resolution: {
          type: 'directory',
          directory: path.join(opts.lockfileDir, dedupedProjectId),
        },
      };

      const importer = opts.resolvedImporters[id];

      if (typeof importer === 'undefined') {
        continue;
      }

      importer.directDependencies[index] = linkedDep;

      importer.linkedDependencies.push(linkedDep);
    }
  }
}
