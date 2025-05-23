import fs from 'node:fs';
import path from 'node:path';
import { docsUrl } from '../../cli-utils/index.ts';
import { WANTED_LOCKFILE } from '../../constants/index.ts';
import { OspmError } from '../../error/index.ts';
import { readProjectManifestOnly } from '../../read-project-manifest/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../../store-connection-manager/index.ts';
import gfs from '../../graceful-fs/index.ts';
import { install, type InstallOptions } from '../../core/index.ts';
import type { Config } from '../../config/index.ts';
import { findWorkspacePackages } from '../../workspace.find-packages/index.ts';
import type { ProjectsGraph, Project } from '../../types/index.ts';
import { logger } from '../../logger/index.ts';
import { sequenceGraph } from '../../sort-packages/index.ts';
import rimraf from '@zkochan/rimraf';
import { loadJsonFile } from 'load-json-file';
import mapValues from 'ramda/src/map';
import renderHelp from 'render-help';
import { parse as parseYarnLock, type LockFileObject } from '@yarnpkg/lockfile';
import * as yarnCore from '@yarnpkg/core';
import { parseSyml } from '@yarnpkg/parsers';
import { recursive } from '../recursive.ts';
import { yarnLockFileKeyNormalizer } from './yarnUtil.ts';
import { getOptionsFromRootManifest } from '../../config/getOptionsFromRootManifest.ts';

type NpmPackageLock = {
  dependencies: LockedPackagesMap;
  packages: LockedPackagesMap;
  name?: string | undefined;
};

type LockedPackage = {
  version: string;
  lockfileVersion: number;
  name?: string | undefined;
  dependencies?: LockedPackagesMap | SimpleDependenciesMap | undefined;
  packages?: LockedPackagesMap | undefined;
};

type SimpleDependenciesMap = {
  [name: string]: string;
};

type LockedPackagesMap = {
  [name: string]: LockedPackage;
};

type YarnLockPackage = {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?:
    | {
        [name: string]: string;
      }
    | undefined;
  optionalDependencies?:
    | {
        [depName: string]: string;
      }
    | undefined;
};
type YarnPackageLock = {
  [name: string]: YarnLockPackage;
};

enum YarnLockType {
  yarn = 'yarn',
  yarn2 = 'yarn2',
}

// copy from yarn v1
type YarnLock2Struct = {
  type: YarnLockType.yarn2;
  object: YarnPackageLock;
};

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export function help(): string {
  return renderHelp({
    description: `Generates ${WANTED_LOCKFILE} from an npm package-lock.json (or npm-shrinkwrap.json, yarn.lock) file.`,
    url: docsUrl('import'),
    usages: ['ospm import'],
  });
}

export const commandNames = ['import'];

export type ImportCommandOptions = Pick<
  Config,
  | 'allProjects'
  | 'allProjectsGraph'
  | 'selectedProjectsGraph'
  | 'workspaceDir'
  | 'ignoreWorkspaceCycles'
  | 'disallowWorkspaceCycles'
  | 'sharedWorkspaceLockfile'
  | 'workspacePackagePatterns'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
> &
  CreateStoreControllerOptions &
  Omit<
    InstallOptions,
    'storeController' | 'lockfileOnly' | 'preferredVersions'
  >;

export async function handler(
  opts: ImportCommandOptions,
  params: string[]
): Promise<void> {
  // Removing existing ospm lockfile
  // it should not influence the new one
  await rimraf(path.join(opts.dir, WANTED_LOCKFILE));
  const versionsByPackageNames = {};
  let preferredVersions = {};
  if (fs.existsSync(path.join(opts.dir, 'yarn.lock'))) {
    const yarnPackageLockFile = await readYarnLockFile(opts.dir);
    getAllVersionsFromYarnLockFile(yarnPackageLockFile, versionsByPackageNames);
  } else if (
    fs.existsSync(path.join(opts.dir, 'package-lock.json')) ||
    fs.existsSync(path.join(opts.dir, 'npm-shrinkwrap.json'))
  ) {
    const npmPackageLock = await readNpmLockfile(opts.dir);
    if (npmPackageLock.lockfileVersion < 3) {
      getAllVersionsByPackageNamesPreV3(npmPackageLock, versionsByPackageNames);
    } else {
      getAllVersionsByPackageNames(npmPackageLock, versionsByPackageNames);
    }
  } else {
    throw new OspmError('LOCKFILE_NOT_FOUND', 'No lockfile found');
  }
  preferredVersions = getPreferredVersions(versionsByPackageNames);

  // For a workspace with shared lockfile
  if (typeof opts.workspaceDir === 'string') {
    const allProjects =
      opts.allProjects ??
      (await findWorkspacePackages(opts.workspaceDir, {
        ...opts,
        patterns: opts.workspacePackagePatterns,
      }));

    const selectedProjectsGraph =
      opts.selectedProjectsGraph ?? selectProjectByDir(allProjects, opts.dir);

    if (selectedProjectsGraph != null) {
      const sequencedGraph = sequenceGraph(selectedProjectsGraph);

      // Check and warn if there are cyclic dependencies
      if (opts.ignoreWorkspaceCycles !== true && !sequencedGraph.safe) {
        const cyclicDependenciesInfo =
          sequencedGraph.cycles.length > 0
            ? `: ${sequencedGraph.cycles.map((deps) => deps.join(', ')).join('; ')}`
            : '';

        if (opts.disallowWorkspaceCycles === true) {
          throw new OspmError(
            'DISALLOW_WORKSPACE_CYCLES',
            `There are cyclic workspace dependencies${cyclicDependenciesInfo}`
          );
        }

        logger.warn({
          message: `There are cyclic workspace dependencies${cyclicDependenciesInfo}`,
          prefix: opts.workspaceDir,
        });
      }

      await recursive(
        allProjects,
        params,
        {
          ...opts,
          lockfileDir: opts.lockfileDir,
          ospmfile: opts.ospmfile ?? '',
          lockfileOnly: true,
          registries: opts.registries ?? {
            default: 'https://registry.npmjs.org/',
          },
          selectedProjectsGraph,
          preferredVersions,
          workspaceDir: opts.workspaceDir,
          rawLocalConfig: {},
          bail: false,
          linkWorkspacePackages: false,
        },
        'import'
      );
    }

    return;
  }

  const store = await createOrConnectStoreController(opts);

  const manifest = await readProjectManifestOnly(opts.dir);

  const manifestOpts = opts.rootProjectManifest
    ? getOptionsFromRootManifest(
        opts.rootProjectManifestDir,
        opts.rootProjectManifest
      )
    : {};

  const installOpts = {
    ...opts,
    ...manifestOpts,
    binsDir: '',
    update: false,
    allowNonAppliedPatches: opts.allowNonAppliedPatches ?? false,
    allowedDeprecatedVersions: opts.allowedDeprecatedVersions ?? {},
    overrides: opts.overrides ?? {},
    ignoredOptionalDependencies: opts.ignoredOptionalDependencies ?? [],
    packageExtensions: opts.packageExtensions ?? {},
    lockfileOnly: true,
    preferredVersions,
    storeController: store.ctrl,
    storeDir: store.dir,
  };
  await install(manifest, installOpts);
}

async function readYarnLockFile(dir: string): Promise<LockFileObject> {
  try {
    const yarnLockFile = await gfs.readFile(
      path.join(dir, 'yarn.lock'),
      'utf8'
    );

    const yarnLockFileType = getYarnLockfileType(yarnLockFile);

    if (yarnLockFileType === YarnLockType.yarn) {
      const lockJsonFile = parseYarnLock(yarnLockFile);

      if (lockJsonFile.type === 'success') {
        return lockJsonFile.object;
      }

      throw new OspmError(
        'YARN_LOCKFILE_PARSE_FAILED',
        `Yarn.lock file was ${lockJsonFile.type}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (yarnLockFileType === YarnLockType.yarn2) {
      const lockJsonFile = parseYarn2Lock(yarnLockFile);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (lockJsonFile.type === YarnLockType.yarn2) {
        return lockJsonFile.object;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  throw new OspmError('YARN_LOCKFILE_NOT_FOUND', 'No yarn.lock found');
}

function parseYarn2Lock(lockFileContents: string): YarnLock2Struct {
  const parseYarnLock = parseSyml(lockFileContents);

  // biome-ignore lint/performance/noDelete: <explanation>
  delete parseYarnLock.__metadata;

  const dependencies: YarnPackageLock = {};

  const { structUtils } = yarnCore;

  const { parseDescriptor, parseRange } = structUtils;

  const keyNormalizer = yarnLockFileKeyNormalizer(parseDescriptor, parseRange);

  for (const fullDescriptor in parseYarnLock) {
    const versionData = parseYarnLock[fullDescriptor];

    for (const descriptor of keyNormalizer(fullDescriptor)) {
      dependencies[descriptor] = versionData;
    }
  }

  return {
    object: dependencies,
    type: YarnLockType.yarn2,
  };
}

async function readNpmLockfile(dir: string): Promise<LockedPackage> {
  try {
    return await loadJsonFile<LockedPackage>(
      path.join(dir, 'package-lock.json')
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  try {
    return await loadJsonFile<LockedPackage>(
      path.join(dir, 'npm-shrinkwrap.json')
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  throw new OspmError(
    'NPM_LOCKFILE_NOT_FOUND',
    'No package-lock.json or npm-shrinkwrap.json found'
  );
}

function getPreferredVersions(
  versionsByPackageNames: VersionsByPackageNames
): Record<string, Record<string, string>> {
  return mapValues.default((versions: Set<string>): { [k: string]: string } => {
    return Object.fromEntries(
      Array.from(versions).map((version) => [version, 'version'])
    );
  }, versionsByPackageNames);
}

type VersionsByPackageNames = Record<string, Set<string>>;

function getAllVersionsByPackageNamesPreV3(
  npmPackageLock: NpmPackageLock | LockedPackage,
  versionsByPackageNames: VersionsByPackageNames
): void {
  if (npmPackageLock.dependencies == null) {
    return;
  }

  for (const [packageName, { version }] of Object.entries(
    npmPackageLock.dependencies
  )) {
    if (!versionsByPackageNames[packageName]) {
      versionsByPackageNames[packageName] = new Set();
    }

    versionsByPackageNames[packageName].add(version);
  }

  for (const dep of Object.values(npmPackageLock.dependencies)) {
    getAllVersionsByPackageNamesPreV3(dep, versionsByPackageNames);
  }
}

function getAllVersionsByPackageNames(
  pkg: NpmPackageLock | LockedPackage,
  versionsByPackageNames: VersionsByPackageNames
): void {
  if (pkg.dependencies) {
    extractDependencies(
      versionsByPackageNames,
      pkg.dependencies as LockedPackagesMap
    );
  }

  if ('packages' in pkg && pkg.packages) {
    extractDependencies(versionsByPackageNames, pkg.packages);
  }
}

function extractDependencies(
  versionsByPackageNames: VersionsByPackageNames,
  dependencies: LockedPackagesMap
): void {
  for (let [pkgName, pkgDetails] of Object.entries(dependencies)) {
    if (pkgName.includes('node_modules')) {
      pkgName = pkgName.substring(pkgName.lastIndexOf('node_modules/') + 13);
    }

    if (!versionsByPackageNames[pkgName]) {
      versionsByPackageNames[pkgName] = new Set<string>();
    }

    if (pkgDetails.version) {
      versionsByPackageNames[pkgName]?.add(pkgDetails.version);
    }

    if (pkgDetails.packages) {
      extractDependencies(versionsByPackageNames, pkgDetails.packages);
    }
    if (pkgDetails.dependencies) {
      for (const [pkgName1, version] of Object.entries(
        pkgDetails.dependencies
      )) {
        if (!versionsByPackageNames[pkgName1]) {
          versionsByPackageNames[pkgName1] = new Set<string>();
        }

        versionsByPackageNames[pkgName1].add(version);
      }
    }
  }
}

function getAllVersionsFromYarnLockFile(
  yarnPackageLock: LockFileObject,
  versionsByPackageNames: {
    [packageName: string]: Set<string>;
  }
): void {
  for (const [packageName, { version }] of Object.entries(yarnPackageLock)) {
    const pkgName = packageName.substring(0, packageName.lastIndexOf('@'));

    if (!versionsByPackageNames[pkgName]) {
      versionsByPackageNames[pkgName] = new Set();
    }

    versionsByPackageNames[pkgName].add(version);
  }
}

function selectProjectByDir(
  projects: Project[],
  searchedDir: string
): ProjectsGraph | undefined {
  const project = projects.find(({ rootDir }: Project): boolean => {
    return path.relative(rootDir, searchedDir) === '';
  });

  if (project == null) {
    return undefined;
  }

  return { [searchedDir]: { dependencies: [], package: project } };
}

function getYarnLockfileType(lockFileContents: string): YarnLockType {
  return lockFileContents.includes('__metadata')
    ? YarnLockType.yarn2
    : YarnLockType.yarn;
}
