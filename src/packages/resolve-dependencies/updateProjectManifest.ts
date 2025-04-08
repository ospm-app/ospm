import {
  createVersionSpec,
  getPrefix,
  type PackageSpecObject,
  type PinnedVersion,
  updateProjectManifestObject,
} from '../manifest-utils/index.ts';
import versionSelectorType from 'version-selector-type';
import semver from 'semver';
import { isGitHostedPkgUrl } from '../pick-fetcher/index.ts';
import type { TarballResolution } from '../resolver-base/index.ts';
import type { ProjectManifest } from '../types/index.ts';
import type { ResolvedDirectDependency } from './resolveDependencyTree.ts';
import type { ImporterToResolve } from './index.ts';

export async function updateProjectManifest(
  importer: ImporterToResolve,
  opts: {
    directDependencies: ResolvedDirectDependency[];
    preserveWorkspaceProtocol: boolean;
    saveWorkspaceProtocol: boolean | 'rolling';
  }
): Promise<Array<ProjectManifest | undefined>> {
  if (typeof importer.manifest === 'undefined') {
    throw new Error('Cannot save because no package.json found');
  }

  const specsToUpsert = opts.directDependencies
    .filter((_rdd, index: number): boolean => {
      return importer.wantedDependencies[index]?.updateSpec === true;
    })
    .map((rdd: ResolvedDirectDependency, index: number) => {
      const wantedDep = importer.wantedDependencies[index];

      if (!wantedDep) {
        return undefined;
      }

      return resolvedDirectDepToSpecObject(
        {
          ...rdd,
          isNew: wantedDep.isNew,
          specRaw: wantedDep.raw,
          preserveNonSemverVersionSpec: wantedDep.preserveNonSemverVersionSpec,
          // For git-protocol dependencies that are already installed locally, there is no normalizedPref unless do force resolve,
          // so we use pref in wantedDependency here.
          normalizedPref:
            rdd.normalizedPref ??
            (isGitHostedPkgUrl(
              (rdd.resolution as TarballResolution).tarball ?? ''
            )
              ? wantedDep.pref
              : undefined),
        },
        importer,
        {
          nodeExecPath: wantedDep.nodeExecPath,
          pinnedVersion:
            wantedDep.pinnedVersion ?? importer.pinnedVersion ?? 'major',
          preserveWorkspaceProtocol: opts.preserveWorkspaceProtocol,
          saveWorkspaceProtocol: opts.saveWorkspaceProtocol,
        }
      );
    })
    .filter(Boolean);

  for (const pkgToInstall of importer.wantedDependencies) {
    if (
      pkgToInstall.updateSpec === true &&
      typeof pkgToInstall.alias === 'string' &&
      !specsToUpsert.some(({ alias }) => alias === pkgToInstall.alias)
    ) {
      specsToUpsert.push({
        alias: pkgToInstall.alias,
        nodeExecPath: pkgToInstall.nodeExecPath,
        peer: importer.peer,
        saveType: importer.targetDependenciesField,
      });
    }
  }

  const hookedManifest = await updateProjectManifestObject(
    importer.rootDir,
    importer.manifest,
    specsToUpsert
  );

  const originalManifest =
    importer.originalManifest != null
      ? await updateProjectManifestObject(
          importer.rootDir,
          importer.originalManifest,
          specsToUpsert
        )
      : undefined;

  return [hookedManifest, originalManifest];
}

function resolvedDirectDepToSpecObject(
  {
    alias,
    catalogLookup,
    isNew,
    name,
    normalizedPref,
    resolution,
    specRaw,
    version,
    preserveNonSemverVersionSpec,
  }: ResolvedDirectDependency & {
    isNew?: boolean | undefined;
    specRaw?: string | undefined;
    preserveNonSemverVersionSpec?: boolean | undefined;
  },
  importer: ImporterToResolve,
  opts: {
    nodeExecPath?: string | undefined;
    pinnedVersion: PinnedVersion;
    preserveWorkspaceProtocol: boolean;
    saveWorkspaceProtocol: boolean | 'rolling';
  }
): PackageSpecObject {
  let pref: string | undefined;

  if (catalogLookup) {
    pref = catalogLookup.userSpecifiedPref;
  } else if (typeof normalizedPref === 'string') {
    pref = normalizedPref;
  } else {
    const shouldUseWorkspaceProtocol =
      typeof resolution !== 'undefined' &&
      'type' in resolution &&
      resolution.type === 'directory' &&
      (Boolean(opts.saveWorkspaceProtocol) ||
        (opts.preserveWorkspaceProtocol &&
          specRaw?.includes('@workspace:') === true)) &&
      opts.pinnedVersion !== 'none';

    pref =
      isNew === true
        ? getPrefPreferSpecifiedSpec({
            alias,
            name,
            pinnedVersion: opts.pinnedVersion,
            specRaw,
            version,
            rolling:
              shouldUseWorkspaceProtocol === true &&
              opts.saveWorkspaceProtocol === 'rolling',
          })
        : getPrefPreferSpecifiedExoticSpec({
            alias,
            name,
            pinnedVersion: opts.pinnedVersion,
            specRaw,
            version,
            rolling:
              shouldUseWorkspaceProtocol &&
              opts.saveWorkspaceProtocol === 'rolling',
            preserveNonSemverVersionSpec,
          });

    if (shouldUseWorkspaceProtocol && !pref.startsWith('workspace:')) {
      pref = pref.replace(/^npm:/, '');

      pref = `workspace:${pref}`;
    }
  }

  return {
    alias,
    nodeExecPath: opts.nodeExecPath,
    peer: importer.peer,
    pref,
    saveType: importer.targetDependenciesField,
  };
}

function getPrefPreferSpecifiedSpec(opts: {
  alias: string;
  name: string;
  version: string;
  specRaw?: string | undefined;
  pinnedVersion?: PinnedVersion | undefined;
  rolling: boolean;
}): string {
  const prefix = getPrefix(opts.alias, opts.name);

  if (opts.specRaw?.startsWith(`${opts.alias}@${prefix}`) === true) {
    const range = opts.specRaw.slice(`${opts.alias}@${prefix}`.length);

    if (range) {
      const selector = versionSelectorType(range);

      if (
        selector != null &&
        (selector.type === 'version' || selector.type === 'range')
      ) {
        return opts.specRaw.slice(opts.alias.length + 1);
      }
    }
  }

  // A prerelease version is always added as an exact version
  if (typeof semver.parse(opts.version)?.prerelease.length === 'number') {
    return `${prefix}${opts.version}`;
  }

  return `${prefix}${createVersionSpec(opts.version, { pinnedVersion: opts.pinnedVersion, rolling: opts.rolling })}`;
}

function getPrefPreferSpecifiedExoticSpec(opts: {
  alias: string;
  name: string;
  version: string;
  specRaw?: string | undefined;
  pinnedVersion: PinnedVersion;
  rolling: boolean;
  preserveNonSemverVersionSpec?: boolean | undefined;
}): string {
  const prefix = getPrefix(opts.alias, opts.name);

  if (opts.specRaw?.startsWith(`${opts.alias}@${prefix}`) === true) {
    let specWithoutName = opts.specRaw.slice(`${opts.alias}@${prefix}`.length);

    if (specWithoutName.startsWith('workspace:')) {
      specWithoutName = specWithoutName.slice(10);

      if (
        specWithoutName === '*' ||
        specWithoutName === '^' ||
        specWithoutName === '~'
      ) {
        return specWithoutName;
      }
    }

    const selector = versionSelectorType(specWithoutName);

    if (
      (selector == null ||
        (selector.type !== 'version' && selector.type !== 'range')) &&
      opts.preserveNonSemverVersionSpec === true
    ) {
      return opts.specRaw.slice(opts.alias.length + 1);
    }
  }

  // A prerelease version is always added as an exact version
  if (typeof semver.parse(opts.version)?.prerelease.length === 'number') {
    return `${prefix}${opts.version}`;
  }

  return `${prefix}${createVersionSpec(opts.version, { pinnedVersion: opts.pinnedVersion, rolling: opts.rolling })}`;
}
