import { promises as fs } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { LOCKFILE_VERSION, WANTED_LOCKFILE } from '../constants/index.ts';
import { PnpmError } from '../error/index.ts';
import { mergeLockfileChanges } from '../lockfile.merger/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { ProjectId } from '../types/index.ts';
import comverToSemver from 'comver-to-semver';
import yaml from 'js-yaml';
import semver from 'semver';
import stripBom from 'strip-bom';
import { LockfileBreakingChangeError } from './errors/index.ts';
import { autofixMergeConflicts, isDiff } from './gitMergeFile.ts';
import { lockfileLogger as logger } from './logger.ts';
import { getWantedLockfileName } from './lockfileName.ts';
import { getGitBranchLockfileNames } from './gitBranchLockfile.ts';
import { convertToLockfileObject } from './lockfileFormatConverters.ts';

export async function readCurrentLockfile(
  virtualStoreDir: string,
  opts: {
    wantedVersions?: string[];
    ignoreIncompatible: boolean;
  }
): Promise<LockfileObject | null> {
  const lockfilePath = path.join(virtualStoreDir, 'lock.yaml');

  return (await _read(lockfilePath, virtualStoreDir, opts)).lockfile;
}

export async function readWantedLockfileAndAutofixConflicts(
  pkgPath: string | undefined,
  opts: {
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
    useGitBranchLockfile?: boolean | undefined;
    mergeGitBranchLockfiles?: boolean | undefined;
  }
): Promise<{
  lockfile: LockfileObject | null;
  hadConflicts: boolean;
}> {
  return _readWantedLockfile(pkgPath, {
    ...opts,
    autofixMergeConflicts: true,
  });
}

export async function readWantedLockfile(
  pkgPath: string | undefined,
  opts: {
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
    useGitBranchLockfile?: boolean | undefined;
    mergeGitBranchLockfiles?: boolean | undefined;
  }
): Promise<LockfileObject | null> {
  return (await _readWantedLockfile(pkgPath ?? '', opts)).lockfile;
}

async function _read(
  lockfilePath: string,
  prefix: string, // only for logging
  opts: {
    autofixMergeConflicts?: boolean | undefined;
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
  }
): Promise<{
  lockfile: LockfileObject | null;
  hadConflicts: boolean;
}> {
  let lockfileRawContent: string | undefined;

  try {
    lockfileRawContent = stripBom(await fs.readFile(lockfilePath, 'utf8'));
  } catch (err: unknown) {
    if (
      !(util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT')
    ) {
      throw err;
    }

    return {
      lockfile: null,
      hadConflicts: false,
    };
  }

  let lockfile: LockfileObject | undefined;

  let hadConflicts: boolean;

  try {
    lockfile = convertToLockfileObject(yaml.load(lockfileRawContent) as any); // eslint-disable-line

    hadConflicts = false;
  } catch (err: unknown) {
    if (opts.autofixMergeConflicts !== true || !isDiff(lockfileRawContent)) {
      throw new PnpmError(
        'BROKEN_LOCKFILE',
        `The lockfile at "${lockfilePath}" is broken: ${(err as Error).message}`
      );
    }

    hadConflicts = true;

    lockfile = autofixMergeConflicts(lockfileRawContent);

    logger.info({
      message: `Merge conflict detected in ${WANTED_LOCKFILE} and successfully merged`,
      prefix,
    });
  }

  if (typeof lockfile !== 'undefined') {
    const lockfileSemver = comverToSemver(
      (lockfile.lockfileVersion || 0).toString()
    );

    if (
      !opts.wantedVersions ||
      opts.wantedVersions.length === 0 ||
      opts.wantedVersions.some((wantedVersion) => {
        if (
          semver.major(lockfileSemver) !==
          semver.major(comverToSemver(wantedVersion))
        ) {
          return false;
        }

        if (
          lockfile.lockfileVersion !== '6.1' &&
          semver.gt(lockfileSemver, comverToSemver(wantedVersion))
        ) {
          logger.warn({
            message:
              `Your ${WANTED_LOCKFILE} was generated by a newer version of pnpm. ` +
              `It is a compatible version but it might get downgraded to version ${wantedVersion}`,
            prefix,
          });
        }

        return true;
      })
    ) {
      return { lockfile, hadConflicts };
    }
  }

  if (opts.ignoreIncompatible) {
    logger.warn({
      message: `Ignoring not compatible lockfile at ${lockfilePath}`,
      prefix,
    });

    return { lockfile: null, hadConflicts: false };
  }

  throw new LockfileBreakingChangeError(lockfilePath);
}

export function createLockfileObject(
  importerIds: ProjectId[],
  opts: {
    lockfileVersion: string;
    autoInstallPeers?: boolean | undefined;
    excludeLinksFromLockfile?: boolean | undefined;
    peersSuffixMaxLength?: number | undefined;
  }
): LockfileObject {
  const importers: LockfileObject['importers'] = {};

  for (const importerId of importerIds) {
    importers[importerId] = {
      dependencies: {},
      specifiers: {},
    };
  }

  return {
    importers,
    lockfileVersion: opts.lockfileVersion || LOCKFILE_VERSION,
    settings: {
      autoInstallPeers: opts.autoInstallPeers,
      excludeLinksFromLockfile: opts.excludeLinksFromLockfile,
      peersSuffixMaxLength: opts.peersSuffixMaxLength,
    },
  };
}

async function _readWantedLockfile(
  pkgPath: string | undefined,
  opts: {
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
    useGitBranchLockfile?: boolean | undefined;
    mergeGitBranchLockfiles?: boolean | undefined;
    autofixMergeConflicts?: boolean | undefined;
  }
): Promise<{
  lockfile: LockfileObject | null;
  hadConflicts: boolean;
}> {
  const lockfileNames: string[] = [WANTED_LOCKFILE];

  if (opts.useGitBranchLockfile === true) {
    const gitBranchLockfileName: string = await getWantedLockfileName(opts);

    if (gitBranchLockfileName !== WANTED_LOCKFILE) {
      lockfileNames.unshift(gitBranchLockfileName);
    }
  }

  let result: { lockfile: LockfileObject | null; hadConflicts: boolean } = {
    lockfile: null,
    hadConflicts: false,
  };

  for (const lockfileName of lockfileNames) {
    result = await _read(
      path.join(pkgPath ?? '', lockfileName),
      pkgPath ?? '',
      {
        ...opts,
        autofixMergeConflicts: true,
      }
    );

    if (result.lockfile) {
      if (opts.mergeGitBranchLockfiles === true) {
        result.lockfile = await _mergeGitBranchLockfiles(
          result.lockfile,
          pkgPath ?? '',
          pkgPath ?? '',
          opts
        );
      }

      break;
    }
  }

  return result;
}

async function _mergeGitBranchLockfiles(
  lockfile: LockfileObject | null,
  lockfileDir: string,
  prefix: string,
  opts: {
    autofixMergeConflicts?: boolean | undefined;
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
  }
): Promise<LockfileObject | null> {
  if (lockfile === null) {
    return lockfile;
  }

  const gitBranchLockfiles: Array<LockfileObject | null> = (
    await _readGitBranchLockfiles(lockfileDir, prefix, opts)
  ).map(({ lockfile }) => lockfile);

  let mergedLockfile: LockfileObject = lockfile;

  for (const gitBranchLockfile of gitBranchLockfiles) {
    if (!gitBranchLockfile) {
      continue;
    }
    mergedLockfile = mergeLockfileChanges(mergedLockfile, gitBranchLockfile);
  }

  return mergedLockfile;
}

async function _readGitBranchLockfiles(
  lockfileDir: string,
  prefix: string,
  opts: {
    autofixMergeConflicts?: boolean | undefined;
    wantedVersions?: string[] | undefined;
    ignoreIncompatible: boolean;
  }
): Promise<
  Array<{
    lockfile: LockfileObject | null;
    hadConflicts: boolean;
  }>
> {
  const files = await getGitBranchLockfileNames(lockfileDir);

  return Promise.all(
    files.map((file) => _read(path.join(lockfileDir, file), prefix, opts))
  );
}
