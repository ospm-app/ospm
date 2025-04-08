import { logger } from '../logger/index.ts';
import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import type {
  PreferredVersions,
  WorkspacePackages,
} from '../resolver-base/index.ts';
import type { Dependencies, ProjectManifest } from '../types/index.ts';
import getVerSelType from 'version-selector-type';
import type { ImporterToResolve } from './index.ts';
import {
  getWantedDependencies,
  type WantedDependency,
} from './getWantedDependencies.ts';
import type { ImporterToResolveGeneric } from './resolveDependencyTree.ts';
import { safeIsInnerLink } from './safeIsInnerLink.ts';
import { validatePeerDependencies } from './validatePeerDependencies.ts';
import type { ProjectOptions, HookOptions } from '../get-context/index.ts';

export interface ResolveImporter
  extends ImporterToResolve,
    ImporterToResolveGeneric<{
      binsDir: string;
      isNew?: boolean | undefined;
      updateDepth?: number | undefined;
      preserveNonSemverVersionSpec?: boolean | undefined;
    }> {
  wantedDependencies: Array<
    WantedDependency & {
      binsDir: string;
      isNew?: boolean | undefined;
      updateDepth?: number | undefined;
      preserveNonSemverVersionSpec?: boolean | undefined;
    }
  >;
}

export async function toResolveImporter(
  opts: {
    defaultUpdateDepth: number;
    lockfileOnly: boolean;
    preferredVersions?: PreferredVersions | undefined;
    virtualStoreDir: string;
    workspacePackages: WorkspacePackages;
    updateToLatest?: boolean | undefined;
    noDependencySelectors: boolean;
  },
  project: ProjectOptions &
    HookOptions & {
      binsDir: string;
      updatePackageManifest?: boolean | undefined;
      wantedDependencies?: Array<WantedDependency> | undefined;
    }
): Promise<ImporterToResolveGeneric<{
  isNew?: boolean | undefined;
  updateDepth?: number | undefined;
}> | null> {
  if (typeof project.manifest === 'undefined') {
    return null;
  }

  validatePeerDependencies(project);

  const allDeps = getWantedDependencies(project.manifest);

  const nonLinkedDependencies = await partitionLinkedPackages(allDeps, {
    lockfileOnly: opts.lockfileOnly,
    modulesDir: project.modulesDir,
    projectDir: project.rootDir,
    virtualStoreDir: opts.virtualStoreDir,
    workspacePackages: opts.workspacePackages,
  });

  const defaultUpdateDepth =
    ('update' in project && project.update === true) ||
    ('updateMatching' in project &&
      typeof project.updateMatching !== 'undefined')
      ? opts.defaultUpdateDepth
      : -1;

  const existingDeps = nonLinkedDependencies.filter(
    ({ alias }: WantedDependency): boolean => {
      return (
        project.wantedDependencies?.some(
          (wantedDep: WantedDependency): boolean => {
            return wantedDep.alias === alias;
          }
        ) !== true
      );
    }
  );

  if (opts.updateToLatest === true && opts.noDependencySelectors) {
    for (const dep of existingDeps) {
      dep.updateSpec = true;
    }
  }

  let wantedDependencies:
    | Array<
        WantedDependency & {
          updateDepth?: number | undefined;
        }
      >
    | undefined;

  if (typeof project.manifest === 'undefined') {
    wantedDependencies = [
      ...(project.wantedDependencies ?? []),
      ...existingDeps,
    ].map(
      (
        dep: WantedDependency
      ): WantedDependency & {
        updateDepth?: number | undefined;
      } => {
        return {
          ...dep,
          updateDepth: defaultUpdateDepth,
        };
      }
    );
  } else {
    // Direct local tarballs are always checked,
    // so their update depth should be at least 0
    function updateLocalTarballs(
      dep: {
        isNew?: boolean | undefined;
        preserveNonSemverVersionSpec?: boolean | undefined;
      } & WantedDependency
    ): WantedDependency & {
      // isNew?: boolean | undefined;
      updateDepth?: number | undefined;
      // preserveNonSemverVersionSpec?: boolean | undefined;
    } {
      return {
        ...dep,
        updateDepth:
          'updateMatching' in project &&
          typeof project.updateMatching !== 'undefined'
            ? defaultUpdateDepth
            : typeof dep.pref !== 'undefined' && prefIsLocalTarball(dep.pref)
              ? 0
              : defaultUpdateDepth,
      };
    }

    wantedDependencies = [
      ...(project.wantedDependencies?.map(
        defaultUpdateDepth < 0
          ? updateLocalTarballs
          : (
              dep: WantedDependency
            ): {
              // isNew?: boolean | undefined;
              updateDepth?: number | undefined;
              // preserveNonSemverVersionSpec?: boolean | undefined;
            } & WantedDependency => {
              return { ...dep, updateDepth: defaultUpdateDepth };
            }
      ) ?? []),
      ...existingDeps.map(
        opts.noDependencySelectors &&
          'updateMatching' in project &&
          typeof project.updateMatching !== 'undefined'
          ? updateLocalTarballs
          : (
              dep: WantedDependency
            ): WantedDependency & { updateDepth: number } => {
              return { ...dep, updateDepth: -1 };
            }
      ),
    ];
  }

  if (typeof wantedDependencies !== 'undefined') {
    return {
      ...project,
      // TODO: fix binsDir
      binsDir: '',
      rootDir: project.rootDir,
      hasRemovedDependencies: Boolean(
        'removePackages' in project &&
          Array.isArray(project.removePackages) &&
          project.removePackages.length > 0
      ),
      preferredVersions:
        opts.preferredVersions ??
        (typeof project.manifest === 'undefined'
          ? {}
          : getPreferredVersionsFromPackage(project.manifest)),
      wantedDependencies,
    };
  }

  return null;
}

function prefIsLocalTarball(pref: string): boolean {
  return pref.startsWith('file:') && pref.endsWith('.tgz');
}

async function partitionLinkedPackages(
  dependencies: WantedDependency[],
  opts: {
    projectDir: string;
    lockfileOnly: boolean;
    modulesDir: string;
    virtualStoreDir: string;
    workspacePackages?: WorkspacePackages | undefined;
  }
): Promise<WantedDependency[]> {
  const nonLinkedDependencies: WantedDependency[] = [];

  const linkedAliases = new Set<string>();

  await Promise.all(
    dependencies.map(async (dependency) => {
      if (
        typeof dependency.alias === 'undefined' ||
        opts.workspacePackages?.get(dependency.alias) != null ||
        dependency.pref?.startsWith('workspace:') === true
      ) {
        nonLinkedDependencies.push(dependency);

        return;
      }
      const isInnerLink = await safeIsInnerLink(
        opts.modulesDir,
        dependency.alias,
        {
          hideAlienModules: !opts.lockfileOnly,
          projectDir: opts.projectDir,
          virtualStoreDir: opts.virtualStoreDir,
        }
      );

      if (isInnerLink === true) {
        nonLinkedDependencies.push(dependency);
        return;
      }

      if (dependency.pref?.startsWith('link:') !== true) {
        // This info-log might be better to be moved to the reporter
        logger.info({
          message: `${dependency.alias} is linked to ${opts.modulesDir} from ${isInnerLink}`,
          prefix: opts.projectDir,
        });
      }

      linkedAliases.add(dependency.alias);
    })
  );
  return nonLinkedDependencies;
}

function getPreferredVersionsFromPackage(
  pkg: Pick<
    ProjectManifest,
    'devDependencies' | 'dependencies' | 'optionalDependencies'
  >
): PreferredVersions {
  return getVersionSpecsByRealNames(getAllDependenciesFromManifest(pkg));
}

type VersionSpecsByRealNames = Record<
  string,
  Record<string, 'version' | 'range' | 'tag'>
>;

function getVersionSpecsByRealNames(
  deps: Dependencies
): VersionSpecsByRealNames {
  const acc: VersionSpecsByRealNames = {};
  for (const depName in deps) {
    const currentPref = deps[depName];

    if (typeof currentPref === 'undefined') {
      continue;
    }

    if (currentPref.startsWith('npm:') === true) {
      const pref = currentPref.slice(4);

      const index = pref.lastIndexOf('@');

      const spec = pref.slice(index + 1);

      const selector = getVerSelType(spec);

      if (selector != null) {
        const pkgName = pref.substring(0, index);

        acc[pkgName] = acc[pkgName] || {};

        acc[pkgName][selector.normalized] = selector.type;
      }
    } else if (currentPref.includes(':') !== true) {
      // we really care only about semver specs
      const selector = getVerSelType(currentPref);

      if (selector != null) {
        acc[depName] = acc[depName] || {};
        acc[depName][selector.normalized] = selector.type;
      }
    }
  }
  return acc;
}
