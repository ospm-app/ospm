import type { LockfileObject } from '../lockfile.types/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import { packageIsInstallable } from '../package-is-installable/index.ts';
import {
  lockfileWalkerGroupImporterSteps,
  type LockfileWalkerStep,
} from '../lockfile.walker/index.ts';
import {
  type DepTypes,
  DepType,
  detectDepTypes,
} from '../lockfile.detect-dep-types/index.ts';
import type {
  SupportedArchitectures,
  DependenciesField,
  ProjectId,
  Registries,
  ModulesDir,
} from '../types/index.ts';
import { getPkgInfo } from './getPkgInfo.ts';
import mapValues from 'ramda/src/map';
import type { TarballResolution } from '../resolver-base/index.ts';

export type LicenseNode = {
  name?: string | undefined;
  version?: string | undefined;
  license: string;
  licenseContents?: string | undefined;
  dir: string;
  author?: string | undefined;
  homepage?: string | undefined;
  description?: string | undefined;
  repository?: string | undefined;
  integrity?: string | undefined;
  requires?: Record<string, string | undefined> | undefined;
  dependencies?: { [name: string]: LicenseNode } | undefined;
  dev: boolean;
};

export type LicenseNodeTree = Omit<
  LicenseNode,
  'dir' | 'license' | 'licenseContents' | 'author' | 'homepages' | 'repository'
>;

export interface LicenseExtractOptions {
  storeDir: string;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  modulesDir?: ModulesDir | undefined;
  dir: string;
  registries: Registries;
  supportedArchitectures?: SupportedArchitectures | undefined;
  depTypes: DepTypes;
}

export async function lockfileToLicenseNode(
  step: LockfileWalkerStep,
  options: LicenseExtractOptions
): Promise<Record<string, LicenseNode>> {
  const dependencies: Record<string, LicenseNode> = Object.fromEntries(
    (
      await Promise.all(
        step.dependencies.map(
          async (dependency): Promise<[string, LicenseNode] | null> => {
            const { depPath, pkgSnapshot, next } = dependency;
            const { name, version } = nameVerFromPkgSnapshot(
              depPath,
              pkgSnapshot
            );

            const packageInstallable = await packageIsInstallable(
              pkgSnapshot.id ?? depPath,
              {
                name,
                version,
                cpu: pkgSnapshot.cpu,
                os: pkgSnapshot.os,
                libc: pkgSnapshot.libc,
              },
              {
                optional: pkgSnapshot.optional ?? false,
                lockfileDir: options.dir,
                supportedArchitectures: options.supportedArchitectures,
              }
            );

            // If the package is not installable on the given platform, we ignore the
            // package, typically the case for platform prebuild packages
            if (!packageInstallable) {
              return null;
            }

            const packageInfo = await getPkgInfo(
              {
                id: pkgSnapshot.id ?? depPath,
                name,
                version,
                depPath,
                snapshot: pkgSnapshot,
                registries: options.registries,
              },
              {
                storeDir: options.storeDir,
                virtualStoreDir: options.virtualStoreDir,
                virtualStoreDirMaxLength: options.virtualStoreDirMaxLength,
                dir: options.dir,
                modulesDir:
                  options.modulesDir ?? ('node_modules' as ModulesDir),
              }
            );

            const subdeps = await lockfileToLicenseNode(next(), options);

            const dep: LicenseNode = {
              name,
              dev: options.depTypes[depPath] === DepType.DevOnly,
              integrity: (pkgSnapshot.resolution as TarballResolution)
                .integrity,
              version,
              license: packageInfo.license,
              licenseContents: packageInfo.licenseContents,
              author: packageInfo.author,
              homepage: packageInfo.homepage,
              description: packageInfo.description,
              repository: packageInfo.repository,
              dir: packageInfo.path as string,
            };

            if (Object.keys(subdeps).length > 0) {
              dep.dependencies = subdeps;
              dep.requires = toRequires(subdeps);
            }

            // If the package details could be fetched, we consider it part of the tree
            return [name, dep];
          }
        )
      )
    ).filter(Boolean) as Array<[string, LicenseNode]>
  );

  return dependencies;
}

/**
 * Reads the lockfile and converts it in a node tree of information necessary
 * to generate the licenses summary
 * @param lockfile the lockfile to process
 * @param opts     parsing instructions
 * @returns
 */
export async function lockfileToLicenseNodeTree(
  lockfile: LockfileObject,
  opts: {
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    includedImporterIds?: ProjectId[] | undefined;
  } & LicenseExtractOptions
): Promise<LicenseNodeTree> {
  const importerWalkers = lockfileWalkerGroupImporterSteps(
    lockfile,
    opts.includedImporterIds ??
      (Object.keys(lockfile.importers ?? {}) as ProjectId[]),
    { include: opts.include }
  );

  const depTypes = detectDepTypes(lockfile);

  const dependencies = Object.fromEntries(
    await Promise.all(
      importerWalkers.map(async (importerWalker) => {
        const importerDeps = await lockfileToLicenseNode(importerWalker.step, {
          storeDir: opts.storeDir,
          virtualStoreDir: opts.virtualStoreDir,
          virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
          modulesDir: opts.modulesDir,
          dir: opts.dir,
          registries: opts.registries,
          supportedArchitectures: opts.supportedArchitectures,
          depTypes,
        });
        return [
          importerWalker.importerId,
          {
            dependencies: importerDeps,
            requires: toRequires(importerDeps),
            version: '0.0.0',
            license: undefined,
          },
        ];
      })
    )
  );

  const licenseNodeTree: LicenseNodeTree = {
    name: undefined,
    version: undefined,
    dependencies,
    dev: false,
    integrity: undefined,
    requires: toRequires(dependencies),
  };

  return licenseNodeTree;
}

function toRequires(
  licenseNodesByDepName: Record<string, LicenseNode>
): Record<string, string | undefined> {
  return mapValues.default((licenseNode: LicenseNode): string | undefined => {
    return licenseNode.version;
  }, licenseNodesByDepName);
}
