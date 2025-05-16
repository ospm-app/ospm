import { LOCKFILE_VERSION, WANTED_LOCKFILE } from '../constants/index.ts';
import {
  createLockfileObject,
  existsNonEmptyWantedLockfile,
  isEmptyLockfile,
  readCurrentLockfile,
  readWantedLockfile,
  readWantedLockfileAndAutofixConflicts,
} from '../lockfile.fs/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { logger } from '../logger/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  ProjectId,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import { isCI } from 'ci-info';
import clone from 'ramda/src/clone';
import equals from 'ramda/src/equals';

export type OspmContext = {
  currentLockfile: LockfileObject;
  existsCurrentLockfile: boolean;
  existsWantedLockfile: boolean;
  existsNonEmptyWantedLockfile: boolean;
  wantedLockfile: LockfileObject;
};

export async function readLockfiles(opts: {
  autoInstallPeers?: boolean | undefined;
  excludeLinksFromLockfile?: boolean | undefined;
  peersSuffixMaxLength?: number | undefined;
  force?: boolean | undefined;
  frozenLockfile: boolean;
  projects: Array<{
    id: ProjectId;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  }>;
  lockfileDir:
    | LockFileDir
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir;
  registry: string;
  useLockfile: boolean;
  useGitBranchLockfile?: boolean | undefined;
  mergeGitBranchLockfiles?: boolean | undefined;
  virtualStoreDir: string;
}): Promise<{
  currentLockfile: LockfileObject;
  currentLockfileIsUpToDate: boolean;
  existsCurrentLockfile: boolean;
  existsWantedLockfile: boolean;
  existsNonEmptyWantedLockfile: boolean;
  wantedLockfile: LockfileObject;
  wantedLockfileIsModified: boolean;
  lockfileHadConflicts: boolean;
}> {
  const wantedLockfileVersion = LOCKFILE_VERSION;
  // ignore `ospm-lock.yaml` on CI servers
  // a latest ospm should not break all the builds

  const lockfileOpts = {
    ignoreIncompatible: opts.force ?? isCI,
    wantedVersions: [LOCKFILE_VERSION],
    useGitBranchLockfile: opts.useGitBranchLockfile,
    mergeGitBranchLockfiles: opts.mergeGitBranchLockfiles,
  };

  const fileReads: Array<Promise<LockfileObject | undefined | null>> = [];

  let lockfileHadConflicts = false;

  if (opts.useLockfile) {
    if (opts.frozenLockfile === true) {
      fileReads.push(readWantedLockfile(opts.lockfileDir, lockfileOpts));
    } else {
      fileReads.push(
        (async (): Promise<LockfileObject | null | undefined> => {
          try {
            const { lockfile, hadConflicts } =
              await readWantedLockfileAndAutofixConflicts(
                opts.lockfileDir,
                lockfileOpts
              );

            lockfileHadConflicts = hadConflicts;

            return lockfile;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            logger.warn({
              message: `Ignoring broken lockfile at ${opts.lockfileDir}: ${err.message as string}`,
              prefix: opts.lockfileDir,
            });

            return undefined;
          }
        })()
      );
    }
  } else {
    if (await existsNonEmptyWantedLockfile(opts.lockfileDir, lockfileOpts)) {
      logger.warn({
        message: `A ${WANTED_LOCKFILE} file exists. The current configuration prohibits to read or write a lockfile`,
        prefix: opts.lockfileDir,
      });
    }

    fileReads.push(Promise.resolve(undefined));
  }

  fileReads.push(
    (async (): Promise<LockfileObject | null | undefined> => {
      try {
        return await readCurrentLockfile(opts.virtualStoreDir, lockfileOpts);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        logger.warn({
          message: `Ignoring broken lockfile at ${opts.virtualStoreDir}: ${err.message as string}`,
          prefix: opts.lockfileDir,
        });

        return undefined;
      }
    })()
  );

  const files = await Promise.all<LockfileObject | null | undefined>(fileReads);

  const sopts = {
    autoInstallPeers: opts.autoInstallPeers,
    excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
    lockfileVersion: wantedLockfileVersion,
    peersSuffixMaxLength: opts.peersSuffixMaxLength,
  };

  const importerIds = opts.projects.map(
    (importer: {
      id: ProjectId;
      rootDir:
        | ProjectRootDir
        | ProjectRootDirRealPath
        | GlobalPkgDir
        | WorkspaceDir
        | LockFileDir;
    }): ProjectId => {
      return importer.id;
    }
  );

  const currentLockfile = files[1] ?? createLockfileObject(importerIds, sopts);

  for (const importerId of importerIds) {
    if (
      typeof currentLockfile.importers !== 'undefined' &&
      typeof currentLockfile.importers[importerId] === 'undefined'
    ) {
      currentLockfile.importers[importerId] = {
        specifiers: {},
      };
    }
  }

  const wantedLockfile =
    files[0] ??
    (typeof currentLockfile === 'undefined'
      ? createLockfileObject(importerIds, sopts)
      : clone.default(currentLockfile));

  let wantedLockfileIsModified = false;

  for (const importerId of importerIds) {
    if (
      typeof wantedLockfile.importers !== 'undefined' &&
      typeof wantedLockfile.importers[importerId] === 'undefined'
    ) {
      wantedLockfileIsModified = true;

      wantedLockfile.importers[importerId] = {
        specifiers: {},
      };
    }
  }

  const existsWantedLockfile = files[0] != null;

  return {
    currentLockfile,
    currentLockfileIsUpToDate: equals.default(currentLockfile, wantedLockfile),
    existsCurrentLockfile: files[1] != null,
    existsWantedLockfile,
    existsNonEmptyWantedLockfile:
      existsWantedLockfile && !isEmptyLockfile(wantedLockfile),
    wantedLockfile,
    wantedLockfileIsModified,
    lockfileHadConflicts,
  };
}
