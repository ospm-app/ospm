import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import npa from '@pnpm/npm-package-arg';
import { resolveWorkspaceRange } from '../resolve-workspace-range/index.ts';
import { parsePref, workspacePrefToNpm } from '../npm-resolver/index.ts';
import type { ProjectRootDir, BaseManifest } from '../types/index.ts';
import mapValues from 'ramda/src/map';

export type Package = {
  manifest: BaseManifest;
  rootDir: ProjectRootDir;
};

export type PackageNode<Pkg extends Package> = {
  package: Pkg;
  dependencies: ProjectRootDir[];
};

export function createPkgGraph<Pkg extends Package>(
  pkgs: Pkg[],
  opts?:
    | {
        ignoreDevDeps?: boolean | undefined;
        linkWorkspacePackages?: boolean | undefined;
      }
    | undefined
): {
  graph: Record<
    ProjectRootDir,
    {
      dependencies: ProjectRootDir[];
      package: Pkg;
    }
  >;

  unmatched: Array<{ pkgName: string; range: string }>;
} {
  const pkgMap = createPkgMap<Pkg>(pkgs);

  const pkgMapValues = Object.values(pkgMap);

  let pkgMapByManifestName: Record<string, Pkg[] | undefined> | undefined;

  let pkgMapByDir: Record<string, Pkg | undefined> | undefined;

  const unmatched: Array<{ pkgName: string; range: string }> = [];

  const graph = mapValues.default(
    (
      pkg: Pkg
    ): {
      dependencies: ProjectRootDir[];
      package: Pkg;
    } => {
      return {
        dependencies: createNode(pkg),
        package: pkg,
      };
    },
    pkgMap
  );

  // as Record<ProjectRootDir, PackageNode<Pkg>>;

  return { graph, unmatched };

  function createNode(pkg: Package): ProjectRootDir[] {
    const dependencies = {
      ...pkg.manifest.peerDependencies,
      ...(opts?.ignoreDevDeps !== true && pkg.manifest.devDependencies),
      ...pkg.manifest.optionalDependencies,
      ...pkg.manifest.dependencies,
    };

    return Object.entries(dependencies)
      .map(([depName, rawSpec]) => {
        let spec!: { fetchSpec: string; type: string };

        const isWorkspaceSpec = rawSpec.startsWith('workspace:');

        try {
          if (isWorkspaceSpec) {
            const pref = parsePref(
              workspacePrefToNpm(rawSpec),
              depName,
              'latest',
              ''
            );

            if (pref == null) {
              return null;
            }

            rawSpec = pref.fetchSpec;
            depName = pref.name;
          }

          spec = npa.resolve(depName, rawSpec, pkg.rootDir);
        } catch {
          return '';
        }

        if (spec.type === 'directory') {
          pkgMapByDir ??= getPkgMapByDir<Pkg>(pkgMapValues);

          const resolvedPath = path.resolve(pkg.rootDir, spec.fetchSpec);

          const found = pkgMapByDir[resolvedPath];

          if (found) {
            return found.rootDir;
          }

          // Slow path; only needed when there are case mismatches on case-insensitive filesystems.
          const matchedPkg = pkgMapValues.find(
            (pkg) => path.relative(pkg.rootDir, spec.fetchSpec) === ''
          );

          if (matchedPkg == null) {
            return '';
          }

          pkgMapByDir[resolvedPath] = matchedPkg;

          return matchedPkg.rootDir;
        }

        if (spec.type !== 'version' && spec.type !== 'range') return '';

        pkgMapByManifestName ??= getPkgMapByManifestName(pkgMapValues);

        const pkgs = pkgMapByManifestName[depName];

        if (!pkgs || pkgs.length === 0) return '';

        const versions = pkgs
          .filter(({ manifest }) => manifest.version)
          .map((pkg) => pkg.manifest.version) as string[];

        // explicitly check if false, backwards-compatibility (can be undefined)
        const strictWorkspaceMatching =
          opts?.linkWorkspacePackages === false && !isWorkspaceSpec;

        if (strictWorkspaceMatching) {
          unmatched.push({ pkgName: depName, range: rawSpec });

          return '';
        }

        if (isWorkspaceSpec && versions.length === 0) {
          const matchedPkg = pkgs.find((pkg) => pkg.manifest.name === depName);

          return matchedPkg?.rootDir;
        }

        if (versions.includes(rawSpec)) {
          const matchedPkg = pkgs.find((pkg: Package): boolean => {
            return (
              pkg.manifest.name === depName && pkg.manifest.version === rawSpec
            );
          });

          return matchedPkg?.rootDir;
        }

        const matched = resolveWorkspaceRange(rawSpec, versions);

        if (matched === null) {
          unmatched.push({ pkgName: depName, range: rawSpec });

          return '';
        }

        const matchedPkg = pkgs.find((pkg: Package): boolean => {
          return (
            pkg.manifest.name === depName && pkg.manifest.version === matched
          );
        });

        return matchedPkg?.rootDir;
      })
      .filter(Boolean);
  }
}

function createPkgMap<Pkg extends Package>(
  pkgs: Pkg[]
): Record<ProjectRootDir, Pkg> {
  const pkgMap: Record<ProjectRootDir, Pkg> = {};

  for (const pkg of pkgs) {
    pkgMap[pkg.rootDir] = pkg;
  }

  return pkgMap;
}

function getPkgMapByManifestName<Pkg extends Package>(
  pkgMapValues: Pkg[]
): Record<string, Pkg[] | undefined> {
  const pkgMapByManifestName: Record<string, Pkg[] | undefined> = {};

  for (const pkg of pkgMapValues) {
    if (pkg.manifest.name) {
      if (typeof pkgMapByManifestName[pkg.manifest.name] === 'undefined') {
        pkgMapByManifestName[pkg.manifest.name] = [];
      }

      pkgMapByManifestName[pkg.manifest.name]?.push(pkg);
    }
  }

  return pkgMapByManifestName;
}

function getPkgMapByDir<Pkg extends Package>(
  pkgMapValues: Pkg[]
): Record<string, Pkg | undefined> {
  const pkgMapByDir: Record<string, Pkg | undefined> = {};

  for (const pkg of pkgMapValues) {
    pkgMapByDir[path.resolve(pkg.rootDir)] = pkg;
  }

  return pkgMapByDir;
}
