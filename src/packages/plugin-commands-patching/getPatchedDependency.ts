import path from 'node:path';
import {
  parseWantedDependency,
  type ParseWantedDependencyResult,
} from '../parse-wanted-dependency/index.ts';
import { prompt } from 'enquirer';
import { readCurrentLockfile } from '../lockfile.fs/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import { PnpmError } from '../error/index.ts';
import { readModulesManifest } from '../modules-yaml/index.ts';
import { isGitHostedPkgUrl } from '../pick-fetcher/index.ts';
import realpathMissing from 'realpath-missing';
import semver from 'semver';
import type { Config } from '../config/index.ts';
import type { TarballResolution } from '../resolver-base/index.ts';
import type { ModulesDir, PkgResolutionId } from '../types/index.ts';
import type { PackageSnapshot } from '../lockfile.types/index.ts';

export type GetPatchedDependencyOptions = {
  lockfileDir: string;
} & Pick<Config, 'virtualStoreDir' | 'modulesDir'>;

export type GetPatchedDependencyResult = ParseWantedDependencyResult & {
  applyToAll: boolean;
};

export async function getPatchedDependency(
  rawDependency: string,
  opts: GetPatchedDependencyOptions
): Promise<GetPatchedDependencyResult> {
  const dep = parseWantedDependency(rawDependency);

  const { versions, preferredVersions } = await getVersionsFromLockfile(
    dep,
    opts
  );

  if (!preferredVersions.length) {
    throw new PnpmError(
      'PATCH_VERSION_NOT_FOUND',
      `Can not find ${rawDependency} in project ${opts.lockfileDir}, ${versions.length ? `you can specify currently installed version: ${versions.map(({ version }) => version).join(', ')}.` : `did you forget to install ${rawDependency}?`}`
    );
  }

  dep.alias = dep.alias ?? rawDependency;

  if (preferredVersions.length > 1) {
    const { version, applyToAll } = await prompt<{
      version: string;
      applyToAll: boolean;
    }>([
      {
        type: 'select',
        name: 'version',
        message: 'Choose which version to patch',
        choices: preferredVersions.map(
          (
            preferred: LockfileVersion
          ): {
            name: string;
            message: string;
            value: string;
            hint: string;
          } => {
            return {
              name: preferred.version,
              message: preferred.version,
              value: preferred.gitTarballUrl ?? preferred.version,
              hint:
                typeof preferred.gitTarballUrl === 'string' ? 'Git Hosted' : '',
            };
          }
        ),
        result(selected: string) {
          const selectedVersion = preferredVersions.find(
            (preferred: LockfileVersion): boolean => {
              return preferred.version === selected;
            }
          );

          return selectedVersion?.gitTarballUrl ?? selected;
        },
      },
      {
        type: 'confirm',
        name: 'applyToAll',
        message: 'Apply this patch to all versions?',
      },
    ]);

    return {
      ...dep,
      applyToAll,
      pref: version,
    };
  }

  const preferred = preferredVersions[0];

  return {
    ...dep,
    applyToAll: typeof dep.pref === 'undefined',
    pref: preferred?.gitTarballUrl ?? preferred?.version ?? '',
  };
}

export interface LockfileVersion {
  gitTarballUrl?: string;
  name: string;
  peersSuffix?: string;
  version: string;
}

export interface LockfileVersionsList {
  versions: LockfileVersion[];
  preferredVersions: LockfileVersion[];
}

export async function getVersionsFromLockfile(
  dep: ParseWantedDependencyResult,
  opts: GetPatchedDependencyOptions
): Promise<LockfileVersionsList> {
  const modulesDir: ModulesDir = (await realpathMissing(
    path.join(opts.lockfileDir, opts.modulesDir ?? 'node_modules')
  )) as ModulesDir;

  const modules = await readModulesManifest(modulesDir);

  const lockfile =
    (typeof modules?.virtualStoreDir === 'string' &&
      (await readCurrentLockfile(modules.virtualStoreDir, {
        ignoreIncompatible: true,
      }))) ??
    null;

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!lockfile) {
    throw new PnpmError(
      'PATCH_NO_LOCKFILE',
      'The modules directory is not ready for patching',
      {
        hint: 'Run pnpm install first',
      }
    );
  }

  const pkgName =
    typeof dep.alias === 'string' && typeof dep.pref === 'string'
      ? dep.alias
      : (dep.pref ?? dep.alias);

  const versions = Object.entries(lockfile.packages ?? {})
    .map(
      ([depPath, pkgSnapshot]: [string, PackageSnapshot]): {
        gitTarballUrl: string;
        name: string;
        peersSuffix: string;
        version: string;
        nonSemverVersion?: PkgResolutionId | undefined;
      } => {
        const tarball =
          (pkgSnapshot.resolution as TarballResolution).tarball ?? '';

        return {
          ...nameVerFromPkgSnapshot(depPath, pkgSnapshot),
          gitTarballUrl: isGitHostedPkgUrl(tarball) ? tarball : '',
        };
      }
    )
    .filter(
      ({
        name,
      }: {
        gitTarballUrl: string;
        name: string;
        peersSuffix: string;
        version: string;
        nonSemverVersion?: PkgResolutionId | undefined;
      }): boolean => {
        return name === pkgName;
      }
    );

  return {
    versions,
    preferredVersions: versions.filter(
      ({
        version,
      }: {
        gitTarballUrl?: string | undefined;
        name: string;
        peersSuffix?: string | undefined;
        version: string;
        nonSemverVersion?: PkgResolutionId | undefined;
      }): boolean => {
        return typeof dep.alias === 'string' && typeof dep.pref === 'string'
          ? semver.satisfies(version, dep.pref)
          : true;
      }
    ),
  };
}
