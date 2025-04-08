import { createMatcher } from '../matcher/index.ts';
import type { ProjectRootDir, SupportedArchitectures } from '../types/index.ts';
import {
  findWorkspacePackages,
  type Project,
} from '../workspace.find-packages/index.ts';
import {
  createPkgGraph,
  type Package,
  type PackageNode,
} from '../workspace.pkgs-graph/index.ts';
import isSubdir from 'is-subdir';
import difference from 'ramda/src/difference';
import partition from 'ramda/src/partition';
import pick from 'ramda/src/pick';
import * as micromatch from 'micromatch';
import { getChangedPackages } from './getChangedPackages.ts';
import {
  parsePackageSelector,
  type PackageSelector,
} from './parsePackageSelector.ts';

export { parsePackageSelector, type PackageSelector };

export type WorkspaceFilter = {
  filter: string;
  followProdDepsOnly: boolean;
};

export type PackageGraph<Pkg extends Package> = {
  [id: ProjectRootDir]: PackageNode<Pkg>;
};

type Graph = {
  [nodeId: ProjectRootDir]: ProjectRootDir[];
};

type FilteredGraph<Pkg extends Package> = {
  selectedProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  unmatchedFilters: string[];
};

export type ReadProjectsResult = {
  allProjects: Project[];
  allProjectsGraph: PackageGraph<Project>;
  selectedProjectsGraph: PackageGraph<Project>;
};

export type FilterPackagesOptions = {
  linkWorkspacePackages?: boolean;
  prefix: string;
  workspaceDir: string;
  testPattern?: string[] | undefined;
  changedFilesIgnorePattern?: string[] | undefined;
  useGlobDirFiltering?: boolean | undefined;
  sharedWorkspaceLockfile?: boolean | undefined;
};

export interface FilterPackagesFromDirResult
  extends FilterPackagesResult<Project> {
  allProjects: Project[];
}

export async function filterPackagesFromDir(
  workspaceDir: string,
  filter: WorkspaceFilter[],
  opts: FilterPackagesOptions & {
    engineStrict?: boolean | undefined;
    nodeVersion?: string | undefined;
    patterns?: string[] | undefined;
    supportedArchitectures?: SupportedArchitectures | undefined;
  }
): Promise<FilterPackagesFromDirResult> {
  const allProjects = await findWorkspacePackages(workspaceDir, {
    engineStrict: opts.engineStrict,
    patterns: opts.patterns,
    sharedWorkspaceLockfile: opts.sharedWorkspaceLockfile,
    nodeVersion: opts.nodeVersion,
    supportedArchitectures: opts.supportedArchitectures,
  });

  return {
    allProjects,
    ...(await filterPackages(allProjects, filter, opts)),
  };
}

export interface FilterPackagesResult<Pkg extends Package> {
  allProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  selectedProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  unmatchedFilters: string[];
}

export async function filterPackages<Pkg extends Package>(
  pkgs: Pkg[],
  filter: WorkspaceFilter[],
  opts: FilterPackagesOptions
): Promise<FilterPackagesResult<Pkg>> {
  const packageSelectors = filter.map(({ filter: f, followProdDepsOnly }) => ({
    ...parsePackageSelector(f, opts.prefix),
    followProdDepsOnly,
  }));

  return filterPkgsBySelectorObjects<Pkg>(pkgs, packageSelectors, opts);
}

export async function filterPkgsBySelectorObjects<Pkg extends Package>(
  pkgs: Pkg[],
  packageSelectors: PackageSelector[],
  opts: {
    linkWorkspacePackages?: boolean | undefined;
    workspaceDir: string;
    testPattern?: string[] | undefined;
    changedFilesIgnorePattern?: string[] | undefined;
    useGlobDirFiltering?: boolean | undefined;
  }
): Promise<{
  allProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  selectedProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  unmatchedFilters: string[];
}> {
  const [prodPackageSelectors, allPackageSelectors] = partition.default(
    ({ followProdDepsOnly }) => followProdDepsOnly === true,
    packageSelectors
  );

  if (allPackageSelectors.length > 0 || prodPackageSelectors.length > 0) {
    let filteredGraph: FilteredGraph<Pkg> | undefined;

    const { graph } = createPkgGraph<Pkg>(pkgs, {
      linkWorkspacePackages: opts.linkWorkspacePackages,
    });

    if (allPackageSelectors.length > 0) {
      filteredGraph = await filterWorkspacePackages(
        graph,
        allPackageSelectors,
        {
          workspaceDir: opts.workspaceDir,
          testPattern: opts.testPattern ?? [],
          changedFilesIgnorePattern: opts.changedFilesIgnorePattern ?? [],
          useGlobDirFiltering: opts.useGlobDirFiltering ?? false,
        }
      );
    }

    let prodFilteredGraph: FilteredGraph<Pkg> | undefined;

    if (prodPackageSelectors.length > 0) {
      const { graph } = createPkgGraph<Pkg>(pkgs, {
        ignoreDevDeps: true,
        linkWorkspacePackages: opts.linkWorkspacePackages,
      });

      prodFilteredGraph = await filterWorkspacePackages<Pkg>(
        graph,
        prodPackageSelectors,
        {
          workspaceDir: opts.workspaceDir,
          testPattern: opts.testPattern ?? [],
          changedFilesIgnorePattern: opts.changedFilesIgnorePattern ?? [],
          useGlobDirFiltering: opts.useGlobDirFiltering ?? false,
        }
      );
    }

    return {
      allProjectsGraph: graph,
      selectedProjectsGraph: {
        ...prodFilteredGraph?.selectedProjectsGraph,
        ...filteredGraph?.selectedProjectsGraph,
      },
      unmatchedFilters: [
        ...(prodFilteredGraph !== undefined
          ? prodFilteredGraph.unmatchedFilters
          : []),
        ...(filteredGraph !== undefined ? filteredGraph.unmatchedFilters : []),
      ],
    };
  }

  const { graph } = createPkgGraph<Pkg>(pkgs, {
    linkWorkspacePackages: opts.linkWorkspacePackages,
  });

  return {
    allProjectsGraph: graph,
    selectedProjectsGraph: graph,
    unmatchedFilters: [],
  };
}

export async function filterWorkspacePackages<Pkg extends Package>(
  pkgGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >,
  packageSelectors: PackageSelector[],
  opts: {
    workspaceDir: string;
    testPattern?: string[] | undefined;
    changedFilesIgnorePattern?: string[] | undefined;
    useGlobDirFiltering?: boolean | undefined;
  }
): Promise<{
  selectedProjectsGraph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;
  unmatchedFilters: string[];
}> {
  const [excludeSelectors, includeSelectors] =
    partition.default<PackageSelector>(
      (selector: PackageSelector) => selector.exclude === true,
      packageSelectors
    );

  const fg = _filterGraph.bind(null, pkgGraph, opts);

  const include =
    includeSelectors.length === 0
      ? { selected: Object.keys(pkgGraph), unmatchedFilters: [] }
      : await fg(includeSelectors);

  const exclude = await fg(excludeSelectors);

  return {
    selectedProjectsGraph: pick.default(
      difference.default(
        include.selected,
        exclude.selected
      ) as ProjectRootDir[],
      pkgGraph
    ),
    unmatchedFilters: [
      ...include.unmatchedFilters,
      ...exclude.unmatchedFilters,
    ],
  };
}

async function _filterGraph<Pkg extends Package>(
  pkgGraph: Record<
    ProjectRootDir,
    {
      dependencies: string[];
      package: Pkg;
    }
  >,
  opts: {
    workspaceDir: string;
    testPattern?: string[] | undefined;
    changedFilesIgnorePattern?: string[] | undefined;
    useGlobDirFiltering?: boolean | undefined;
  },
  packageSelectors: PackageSelector[]
): Promise<{
  selected: ProjectRootDir[];
  unmatchedFilters: string[];
}> {
  const cherryPickedPackages = [] as ProjectRootDir[];
  const walkedDependencies = new Set<ProjectRootDir>();
  const walkedDependents = new Set<ProjectRootDir>();
  const walkedDependentsDependencies = new Set<ProjectRootDir>();
  const graph = pkgGraphToGraph(pkgGraph);
  const unmatchedFilters = [] as string[];
  let reversedGraph: Graph | undefined;
  const matchPackagesByPath =
    opts.useGlobDirFiltering === true
      ? matchPackagesByGlob
      : matchPackagesByExactPath;
  for (const selector of packageSelectors) {
    let entryPackages: ProjectRootDir[] | null = null;

    if (typeof selector.diff === 'string') {
      let ignoreDependentForPkgs: ProjectRootDir[] = [];

      [entryPackages, ignoreDependentForPkgs] = await getChangedPackages(
        Object.keys(pkgGraph) as ProjectRootDir[],
        selector.diff,
        {
          changedFilesIgnorePattern: opts.changedFilesIgnorePattern ?? [],
          testPattern: opts.testPattern ?? [],
          workspaceDir: selector.parentDir ?? opts.workspaceDir,
        }
      );

      selectEntries(
        {
          ...selector,
          includeDependents: false,
        },
        ignoreDependentForPkgs
      );
    } else if (typeof selector.parentDir === 'string') {
      entryPackages = matchPackagesByPath(pkgGraph, selector.parentDir);
    }
    if (typeof selector.namePattern === 'string') {
      if (entryPackages == null) {
        entryPackages = matchPackages(pkgGraph, selector.namePattern);
      } else {
        entryPackages = matchPackages(
          pick.default(entryPackages, pkgGraph),
          selector.namePattern
        );
      }
    }

    if (entryPackages == null) {
      throw new Error(
        `Unsupported package selector: ${JSON.stringify(selector)}`
      );
    }

    if (entryPackages.length === 0) {
      if (typeof selector.namePattern === 'string') {
        unmatchedFilters.push(selector.namePattern);
      }
      if (typeof selector.parentDir === 'string') {
        unmatchedFilters.push(selector.parentDir);
      }
    }

    selectEntries(selector, entryPackages);
  }
  const walked = new Set([
    ...walkedDependencies,
    ...walkedDependents,
    ...walkedDependentsDependencies,
  ]);

  for (const cherryPickedPackage of cherryPickedPackages) {
    walked.add(cherryPickedPackage);
  }

  return {
    selected: Array.from(walked),
    unmatchedFilters,
  };

  function selectEntries(
    selector: PackageSelector,
    entryPackages: ProjectRootDir[]
  ): void {
    if (selector.includeDependencies === true) {
      pickSubgraph(graph, entryPackages, walkedDependencies, {
        includeRoot: selector.excludeSelf !== true,
      });
    }

    if (selector.includeDependents === true) {
      if (reversedGraph == null) {
        reversedGraph = reverseGraph(graph);
      }

      pickSubgraph(reversedGraph, entryPackages, walkedDependents, {
        includeRoot: selector.excludeSelf !== true,
      });
    }

    if (
      selector.includeDependencies === true &&
      selector.includeDependents === true
    ) {
      pickSubgraph(
        graph,
        Array.from(walkedDependents),
        walkedDependentsDependencies,
        { includeRoot: false }
      );
    }

    if (
      selector.includeDependencies !== true &&
      selector.includeDependents !== true
    ) {
      Array.prototype.push.apply(cherryPickedPackages, entryPackages);
    }
  }
}

function pkgGraphToGraph<Pkg extends Package>(
  pkgGraph: Record<
    ProjectRootDir,
    {
      dependencies: string[];
      package: Pkg;
    }
  >
): Graph {
  const graph: Graph = {};

  for (const nodeId of Object.keys(pkgGraph) as ProjectRootDir[]) {
    graph[nodeId] = (pkgGraph[nodeId]?.dependencies ?? []) as ProjectRootDir[];
  }

  return graph;
}

function reverseGraph(graph: Graph): Graph {
  const reversedGraph: Graph = {};
  for (const dependentNodeId of Object.keys(graph) as ProjectRootDir[]) {
    for (const dependencyNodeId of graph[dependentNodeId] ?? []) {
      if (reversedGraph[dependencyNodeId]) {
        reversedGraph[dependencyNodeId].push(dependentNodeId);
      } else {
        reversedGraph[dependencyNodeId] = [dependentNodeId];
      }
    }
  }

  return reversedGraph;
}

function matchPackages<Pkg extends Package>(
  graph: Record<
    ProjectRootDir,
    {
      dependencies: string[];
      package: Pkg;
    }
  >,
  pattern: string
): ProjectRootDir[] {
  const match = createMatcher(pattern);

  const matches = Object.keys(graph).filter((id: string): boolean => {
    return (
      typeof graph[id as keyof typeof graph]?.package.manifest.name ===
        'string' &&
      match(graph[id as keyof typeof graph]?.package.manifest.name ?? '')
    );
  });

  if (
    matches.length === 0 &&
    !pattern.startsWith('@') &&
    !pattern.includes('/')
  ) {
    const scopedMatches = matchPackages(graph, `@*/${pattern}`);
    return scopedMatches.length !== 1 ? [] : scopedMatches;
  }

  return matches as ProjectRootDir[];
}

function matchPackagesByExactPath<Pkg extends Package>(
  graph: Record<
    ProjectRootDir,
    {
      dependencies: string[];
      package: Pkg;
    }
  >,
  pathStartsWith: string
): ProjectRootDir[] {
  return (Object.keys(graph) as ProjectRootDir[]).filter((parentDir) =>
    isSubdir(pathStartsWith, parentDir)
  );
}

function matchPackagesByGlob<Pkg extends Package>(
  graph: Record<
    ProjectRootDir,
    {
      dependencies: string[];
      package: Pkg;
    }
  >,
  pathStartsWith: string
): ProjectRootDir[] {
  const format = (str: string): string => {
    return str.replace(/\/$/, '');
  };

  const formattedFilter = pathStartsWith.replace(/\\/g, '/').replace(/\/$/, '');

  return Object.keys(graph).filter((parentDir: string): boolean => {
    return micromatch.isMatch(parentDir, formattedFilter, { format });
  }) as ProjectRootDir[];
}

function pickSubgraph(
  graph: Graph,
  nextNodeIds: ProjectRootDir[],
  walked: Set<ProjectRootDir>,
  opts: {
    includeRoot: boolean;
  }
): void {
  for (const nextNodeId of nextNodeIds) {
    if (!walked.has(nextNodeId)) {
      if (opts.includeRoot) {
        walked.add(nextNodeId);
      }

      if (graph[nextNodeId])
        pickSubgraph(graph, graph[nextNodeId], walked, { includeRoot: true });
    }
  }
}
