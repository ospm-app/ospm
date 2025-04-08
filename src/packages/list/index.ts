import path from 'node:path';
import { safeReadProjectManifestOnly } from '../read-project-manifest/index.ts';
import type { DependenciesField, Registries } from '../types/index.ts';
import {
  type PackageNode,
  buildDependenciesHierarchy,
  type DependenciesHierarchy,
  createPackagesSearcher,
} from '../reviewing.dependencies-hierarchy/index.ts';
import { renderJson } from './renderJson.ts';
import { renderParseable } from './renderParseable.ts';
import { renderTree } from './renderTree.ts';
import type { PackageDependencyHierarchy } from './types.ts';
import { pruneDependenciesTrees } from './pruneTree.ts';

export type { PackageNode } from '../reviewing.dependencies-hierarchy/index.ts';

export {
  renderJson,
  renderParseable,
  renderTree,
  type PackageDependencyHierarchy,
};

const DEFAULTS = {
  alwaysPrintRootPackage: true,
  depth: 0,
  long: false,
  registries: undefined,
  reportAs: 'tree' as const,
  showExtraneous: true,
};

export interface FlattenedSearchPackage extends PackageDependencyHierarchy {
  depPath: string;
}

export function flattenSearchedPackages(
  pkgs: PackageDependencyHierarchy[],
  opts: {
    lockfileDir: string;
  }
): FlattenedSearchPackage[] {
  const flattedPkgs: FlattenedSearchPackage[] = [];

  for (const pkg of pkgs) {
    _walker(
      [
        ...(pkg.optionalDependencies ?? []),
        ...(pkg.dependencies ?? []),
        ...(pkg.devDependencies ?? []),
        ...(pkg.unsavedDependencies ?? []),
      ],
      path.relative(opts.lockfileDir, pkg.path) || '.'
    );
  }

  return flattedPkgs;

  function _walker(packages: PackageNode[], depPath: string): void {
    for (const pkg of packages) {
      const nextDepPath = `${depPath} > ${pkg.name}@${pkg.version}`;

      if (typeof pkg.dependencies?.length === 'number') {
        _walker(pkg.dependencies, nextDepPath);
      } else {
        flattedPkgs.push({
          depPath: nextDepPath,
          ...pkg,
        });
      }
    }
  }
}

export async function searchForPackages(
  packages: string[],
  projectPaths: string[],
  opts: {
    depth?: number | undefined;
    excludePeerDependencies?: boolean;
    lockfileDir: string;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    onlyProjects?: boolean | undefined;
    registries?: Registries | undefined;
    modulesDir?: string | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<PackageDependencyHierarchy[]> {
  const search = createPackagesSearcher(packages);

  return Promise.all(
    Object.entries(
      await buildDependenciesHierarchy(projectPaths, {
        depth: opts.depth,
        excludePeerDependencies: opts.excludePeerDependencies,
        include: opts.include,
        lockfileDir: opts.lockfileDir,
        onlyProjects: opts.onlyProjects,
        registries: opts.registries,
        search,
        modulesDir: opts.modulesDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
      })
    ).map(
      async ([projectPath, buildDependenciesHierarchy]): Promise<{
        dependencies?: PackageNode[] | undefined;
        devDependencies?: PackageNode[] | undefined;
        optionalDependencies?: PackageNode[] | undefined;
        unsavedDependencies?: PackageNode[] | undefined;
        name: string;
        version: string;
        private: boolean | undefined;
        path: string;
      } | null> => {
        const entryPkg = await safeReadProjectManifestOnly(projectPath);

        if (entryPkg === null) {
          return null;
        }

        return {
          name: entryPkg.name,
          version: entryPkg.version,
          private: entryPkg.private,

          path: projectPath,
          ...buildDependenciesHierarchy,
        };
      }
    )
  ).then((pkgs) => {
    return pkgs.filter(Boolean);
  });
}

export async function listForPackages(
  packages: string[],
  projectPaths: string[],
  maybeOpts: {
    alwaysPrintRootPackage?: boolean | undefined;
    depth?: number | undefined;
    lockfileDir: string;
    long?: boolean | undefined;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    onlyProjects?: boolean | undefined;
    reportAs?: 'parseable' | 'tree' | 'json';
    registries?: Registries | undefined;
    modulesDir?: string | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<string> {
  const opts = { ...DEFAULTS, ...maybeOpts };

  const pkgs = await searchForPackages(packages, projectPaths, opts);

  const prunedPkgs = pruneDependenciesTrees(pkgs, 10);

  const print = getPrinter(opts.reportAs);

  return print(prunedPkgs, {
    alwaysPrintRootPackage: opts.alwaysPrintRootPackage,
    depth: opts.depth,
    long: opts.long,
    search: Boolean(packages.length),
    showExtraneous: opts.showExtraneous,
  });
}

export async function list(
  projectPaths: string[],
  maybeOpts: {
    alwaysPrintRootPackage?: boolean | undefined;
    depth?: number | undefined;
    excludePeerDependencies?: boolean | undefined;
    lockfileDir: string;
    long?: boolean | undefined;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    onlyProjects?: boolean | undefined;
    reportAs: 'parseable' | 'tree' | 'json';
    registries?: Registries | undefined;
    showExtraneous?: boolean | undefined;
    modulesDir?: string | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<string> {
  const opts = { ...DEFAULTS, ...maybeOpts };

  const pkgs = await Promise.all(
    Object.entries(
      opts.depth === -1
        ? projectPaths.reduce(
            (acc, projectPath) => {
              acc[projectPath] = {};
              return acc;
            },
            {} as Record<string, DependenciesHierarchy>
          )
        : await buildDependenciesHierarchy(projectPaths, {
            depth: opts.depth,
            excludePeerDependencies: maybeOpts.excludePeerDependencies,
            include: maybeOpts.include,
            lockfileDir: maybeOpts.lockfileDir,
            onlyProjects: maybeOpts.onlyProjects,
            registries: opts.registries,
            modulesDir: opts.modulesDir,
            virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
          })
    ).map(
      async ([projectPath, dependenciesHierarchy]: [
        string,
        DependenciesHierarchy,
      ]): Promise<PackageDependencyHierarchy | null> => {
        const entryPkg = await safeReadProjectManifestOnly(projectPath);

        if (entryPkg === null) {
          return null;
        }

        return {
          name: entryPkg.name,
          version: entryPkg.version,
          private: entryPkg.private,

          path: projectPath,
          ...dependenciesHierarchy,
        } as PackageDependencyHierarchy;
      }
    )
  ).then((pkgs) => {
    return pkgs.filter(Boolean);
  });

  const print = getPrinter(opts.reportAs);
  return print(pkgs, {
    alwaysPrintRootPackage: opts.alwaysPrintRootPackage,
    depth: opts.depth,
    long: opts.long,
    search: false,
    showExtraneous: opts.showExtraneous ?? false,
  });
}

type Printer = (
  packages: PackageDependencyHierarchy[],
  opts: {
    alwaysPrintRootPackage?: boolean | undefined;
    depth?: number | undefined;
    long?: boolean | undefined;
    search: boolean;
    showExtraneous: boolean;
  }
) => Promise<string>;

function getPrinter(reportAs: 'parseable' | 'tree' | 'json'): Printer {
  switch (reportAs) {
    case 'parseable':
      return renderParseable;
    case 'json':
      return renderJson;
    case 'tree':
      return renderTree;
  }
}
