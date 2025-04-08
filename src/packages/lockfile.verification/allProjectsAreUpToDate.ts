import type { Catalogs } from '../catalogs.types/index.ts';
import type { ProjectOptions } from '../get-context/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { WorkspacePackages } from '../resolver-base/index.ts';
import {
  DEPENDENCIES_FIELDS,
  type DependenciesField,
  type ProjectId,
} from '../types/index.ts';
import pEvery from 'p-every';
import isEmpty from 'ramda/src/isEmpty';
import { allCatalogsAreUpToDate } from './allCatalogsAreUpToDate.ts';
import { getWorkspacePackagesByDirectory } from './getWorkspacePackagesByDirectory.ts';
import { linkedPackagesAreUpToDate } from './linkedPackagesAreUpToDate.ts';
import { satisfiesPackageManifest } from './satisfiesPackageManifest.ts';
import { localTarballDepsAreUpToDate } from './localTarballDepsAreUpToDate.ts';

export async function allProjectsAreUpToDate(
  projects: Array<
    Pick<ProjectOptions, 'manifest' | 'rootDir'> & { id: ProjectId }
  >,
  opts: {
    catalogs: Catalogs;
    autoInstallPeers: boolean;
    excludeLinksFromLockfile: boolean;
    linkWorkspacePackages: boolean;
    wantedLockfile: LockfileObject;
    workspacePackages: WorkspacePackages;
    lockfileDir: string;
  }
): Promise<boolean> {
  // Projects may declare dependencies using catalog protocol specifiers. If the
  // catalog config definitions are edited by users, projects using them are out
  // of date.
  if (!allCatalogsAreUpToDate(opts.catalogs, opts.wantedLockfile.catalogs)) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition
  const manifestsByDir = opts.workspacePackages
    ? getWorkspacePackagesByDirectory(opts.workspacePackages)
    : {};

  const _satisfiesPackageManifest = satisfiesPackageManifest.bind(null, {
    autoInstallPeers: opts.autoInstallPeers,
    excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
  });

  const _linkedPackagesAreUpToDate = linkedPackagesAreUpToDate.bind(null, {
    linkWorkspacePackages: opts.linkWorkspacePackages,
    manifestsByDir,
    workspacePackages: opts.workspacePackages,
    lockfilePackages: opts.wantedLockfile.packages,
    lockfileDir: opts.lockfileDir,
  });

  const _localTarballDepsAreUpToDate = localTarballDepsAreUpToDate.bind(null, {
    fileIntegrityCache: new Map<string, Promise<string>>(),
    lockfilePackages: opts.wantedLockfile.packages,
    lockfileDir: opts.lockfileDir,
  });

  return pEvery.default(
    projects,
    async (
      project: Pick<ProjectOptions, 'manifest' | 'rootDir'> & {
        id: ProjectId;
      }
    ): Promise<boolean> => {
      const importer = opts.wantedLockfile.importers?.[project.id];

      if (importer == null) {
        return DEPENDENCIES_FIELDS.every(
          (depType: DependenciesField): boolean => {
            return (
              typeof project.manifest?.[depType] === 'undefined' ||
              isEmpty.default(project.manifest[depType])
            );
          }
        );
      }

      const projectInfo = {
        dir: project.rootDir,
        manifest: project.manifest,
        snapshot: importer,
      };

      return (
        typeof importer !== 'undefined' &&
        typeof project.manifest !== 'undefined' &&
        _satisfiesPackageManifest(importer, project.manifest).satisfies &&
        (await _localTarballDepsAreUpToDate(projectInfo)) &&
        _linkedPackagesAreUpToDate(projectInfo)
      );
    }
  );
}
