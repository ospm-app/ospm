import type { PackageNode } from '../reviewing.dependencies-hierarchy/index.ts';
import sortBy from 'ramda/src/sortBy';
import prop from 'ramda/src/prop';
import type { PackageDependencyHierarchy } from './types.ts';

const sortPackages = sortBy.default(prop.default('name'));

export async function renderParseable(
  pkgs: PackageDependencyHierarchy[],
  opts: {
    long?: boolean | undefined;
    depth?: number | undefined;
    alwaysPrintRootPackage?: boolean | undefined;
    search: boolean;
  }
): Promise<string> {
  const depPaths = new Set<string>();

  return pkgs
    .map(renderParseableForPackage.bind(null, depPaths, opts))
    .filter((p: string): boolean => {
      return p.length !== 0;
    })
    .join('\n');
}

function renderParseableForPackage(
  depPaths: Set<string>,
  opts: {
    long?: boolean | undefined;
    depth?: number | undefined;
    alwaysPrintRootPackage?: boolean | undefined;
    search: boolean;
  },
  pkg: PackageDependencyHierarchy
): string {
  const pkgs = sortPackages(
    flatten(depPaths, [
      ...(pkg.optionalDependencies ?? []),
      ...(pkg.dependencies ?? []),
      ...(pkg.devDependencies ?? []),
      ...(pkg.unsavedDependencies ?? []),
    ])
  );

  if (opts.alwaysPrintRootPackage !== true && pkgs.length === 0) {
    return '';
  }

  if (opts.long === true) {
    let firstLine = pkg.path;

    if (typeof pkg.name === 'string') {
      firstLine += `:${pkg.name}`;

      if (typeof pkg.version === 'string') {
        firstLine += `@${pkg.version}`;
      }

      if (pkg.private === true) {
        firstLine += ':PRIVATE';
      }
    }

    return [
      firstLine,
      ...pkgs.map((pkg) => `${pkg.path}:${pkg.name}@${pkg.version}`),
    ].join('\n');
  }

  return [pkg.path, ...pkgs.map((pkg) => pkg.path)].join('\n');
}

type PackageInfo = {
  name: string;
  version: string;
  path: string;
};

function flatten(depPaths: Set<string>, nodes: PackageNode[]): PackageInfo[] {
  let packages: PackageInfo[] = [];

  for (const node of nodes) {
    // The content output by renderParseable is flat,
    // so we can deduplicate packages that are repeatedly dependent on multiple packages.
    if (depPaths.has(node.path) !== true) {
      depPaths.add(node.path);
      packages.push(node);
    }

    if (
      typeof node.dependencies?.length === 'number' &&
      node.dependencies.length > 0
    ) {
      packages = packages.concat(flatten(depPaths, node.dependencies));
    }
  }

  return packages;
}
