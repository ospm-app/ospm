import path from 'node:path';
import type { Catalogs } from '../catalogs.types/index.ts';
import {
  readCurrentLockfile,
  readWantedLockfile,
} from '../lockfile.fs/index.ts';
import { createMatcher } from '../matcher/index.ts';
import { readModulesManifest } from '../modules-yaml/index.ts';
import type {
  GlobalPkgDir,
  IncludedDependencies,
  LockFileDir,
  ModulesDir,
  ProjectManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import unnest from 'ramda/src/unnest';
import {
  createManifestGetter,
  type ManifestGetterOptions,
} from './createManifestGetter.ts';
import { outdated, type OutdatedPackage } from './outdated.ts';

export async function outdatedDepsOfProjects(
  pkgs: Array<{
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
    manifest: ProjectManifest;
  }>,
  args: string[],
  opts: Omit<ManifestGetterOptions, 'fullMetadata' | 'lockfileDir'> & {
    catalogs?: Catalogs | undefined;
    compatible?: boolean | undefined;
    ignoreDependencies?: string[] | undefined;
    include: IncludedDependencies;
  } & Partial<Pick<ManifestGetterOptions, 'fullMetadata' | 'lockfileDir'>>
): Promise<OutdatedPackage[][]> {
  if (typeof opts.lockfileDir === 'undefined') {
    return unnest.default(
      await Promise.all(
        pkgs.map(
          async (pkg: {
            rootDir:
              | ProjectRootDir
              | ProjectRootDirRealPath
              | GlobalPkgDir
              | WorkspaceDir
              | LockFileDir;
            manifest: ProjectManifest;
          }) => {
            return outdatedDepsOfProjects([pkg], args, {
              ...opts,
              lockfileDir: pkg.rootDir as LockFileDir,
            });
          }
        )
      )
    );
  }

  const lockfileDir: LockFileDir = opts.lockfileDir ?? opts.dir;

  const modules = await readModulesManifest(
    path.join(lockfileDir, 'node_modules') as ModulesDir
  );

  const virtualStoreDir =
    modules?.virtualStoreDir ?? path.join(lockfileDir, 'node_modules/.ospm');

  const currentLockfile = await readCurrentLockfile(virtualStoreDir, {
    ignoreIncompatible: false,
  });

  const wantedLockfile =
    (await readWantedLockfile(lockfileDir, { ignoreIncompatible: false })) ??
    currentLockfile;

  const getLatestManifest = createManifestGetter({
    ...opts,
    fullMetadata: opts.fullMetadata === true,
    lockfileDir,
  });

  return Promise.all(
    pkgs.map(async ({ rootDir, manifest }): Promise<OutdatedPackage[]> => {
      const match = args.length > 0 ? createMatcher(args) : undefined;

      return outdated({
        catalogs: opts.catalogs,
        compatible: opts.compatible,
        currentLockfile,
        getLatestManifest,
        ignoreDependencies: opts.ignoreDependencies,
        include: opts.include,
        lockfileDir,
        manifest,
        match,
        prefix: rootDir,
        registries: opts.registries,
        wantedLockfile,
      });
    })
  );
}
