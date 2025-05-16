import { OspmError } from '../error/index.ts';
import { detectDepTypes } from '../lockfile.detect-dep-types/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type {
  SupportedArchitectures,
  DependenciesField,
  IncludedDependencies,
  ProjectId,
  ProjectManifest,
  Registries,
  ModulesDir,
} from '../types/index.ts';
import {
  type LicenseNode,
  lockfileToLicenseNodeTree,
} from './lockfileToLicenseNodeTree.ts';
import semver from 'semver';

export type LicensePackage = {
  belongsTo: DependenciesField;
  version: string;
  name: string;
  license: string;
  licenseContents?: string | undefined;
  author?: string | undefined;
  homepage?: string | undefined;
  description?: string | undefined;
  repository?: string | undefined;
  path?: string | undefined;
};

/**
 * @private
 * Returns an array of LicensePackages from the given LicenseNode
 * @param licenseNode the license node
 * @returns LicensePackage[]
 */
function getDependenciesFromLicenseNode(
  licenseNode: LicenseNode
): LicensePackage[] {
  if (!licenseNode.dependencies) {
    return [];
  }

  let dependencies: LicensePackage[] = [];

  for (const dependencyName in licenseNode.dependencies) {
    const dependencyNode = licenseNode.dependencies[dependencyName];

    if (typeof dependencyNode === 'undefined') {
      continue;
    }

    const dependenciesOfNode = getDependenciesFromLicenseNode(dependencyNode);

    dependencies = [
      ...dependencies,
      ...dependenciesOfNode,
      {
        belongsTo: dependencyNode.dev ? 'devDependencies' : 'dependencies',
        version: dependencyNode.version as string,
        name: dependencyName,
        license: dependencyNode.license as string,
        licenseContents: dependencyNode.licenseContents,
        author: dependencyNode.author as string,
        homepage: dependencyNode.homepage as string,
        description: dependencyNode.description,
        repository: dependencyNode.repository as string,
        path: dependencyNode.dir,
      },
    ];
  }

  return dependencies;
}

export async function findDependencyLicenses(opts: {
  ignoreDependencies?: Set<string>;
  include?: IncludedDependencies | undefined;
  lockfileDir: string;
  manifest: ProjectManifest;
  storeDir: string;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  modulesDir?: ModulesDir | undefined;
  registries: Registries;
  wantedLockfile: LockfileObject | null;
  includedImporterIds?: ProjectId[] | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
}): Promise<LicensePackage[]> {
  if (opts.wantedLockfile == null) {
    throw new OspmError(
      'LICENSES_NO_LOCKFILE',
      `No lockfile in directory "${opts.lockfileDir}". Run \`ospm install\` to generate one.`
    );
  }

  const depTypes = detectDepTypes(opts.wantedLockfile);

  const licenseNodeTree = await lockfileToLicenseNodeTree(opts.wantedLockfile, {
    dir: opts.lockfileDir,
    modulesDir: opts.modulesDir,
    storeDir: opts.storeDir,
    virtualStoreDir: opts.virtualStoreDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    include: opts.include,
    registries: opts.registries,
    includedImporterIds: opts.includedImporterIds,
    supportedArchitectures: opts.supportedArchitectures,
    depTypes,
  });

  // map: name@ver -> LicensePackage
  const licensePackages = new Map<string, LicensePackage>();

  for (const dependencyName in licenseNodeTree.dependencies) {
    const licenseNode = licenseNodeTree.dependencies[dependencyName];

    if (typeof licenseNode === 'undefined') {
      continue;
    }

    const dependenciesOfNode = getDependenciesFromLicenseNode(licenseNode);

    for (const dependencyNode of dependenciesOfNode) {
      const mapKey = `${dependencyNode.name}@${dependencyNode.version}`;

      const existingVersion = licensePackages.get(mapKey)?.version;

      if (existingVersion === undefined) {
        licensePackages.set(mapKey, dependencyNode);
      }
    }
  }

  // Get all non-duplicate dependencies of the project
  const projectDependencies = Array.from(licensePackages.values());

  return Array.from(projectDependencies).sort(
    (pkg1: LicensePackage, pkg2: LicensePackage): number => {
      return (
        pkg1.name.localeCompare(pkg2.name) ||
        semver.compare(pkg1.version, pkg2.version)
      );
    }
  );
}
