import path from 'node:path';
import type {
  PackageSnapshot,
  ProjectSnapshot,
  PackageSnapshots,
} from '../lockfile.types/index.ts';
import { refIsLocalDirectory } from '../lockfile.utils/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import { refToRelative } from '../dependency-path/index.ts';
import type { WorkspacePackages } from '../resolver-base/index.ts';
import {
  DEPENDENCIES_FIELDS,
  DEPENDENCIES_OR_PEER_FIELDS,
  type DependencyManifest,
  type ProjectManifest,
} from '../types/index.ts';
import pEvery from 'p-every';
import semver from 'semver';
import getVersionSelectorType from 'version-selector-type';

export async function linkedPackagesAreUpToDate(
  {
    linkWorkspacePackages,
    manifestsByDir,
    workspacePackages,
    lockfilePackages,
    lockfileDir,
  }: {
    linkWorkspacePackages: boolean;
    manifestsByDir: Record<string, DependencyManifest>;
    workspacePackages?: WorkspacePackages | undefined;
    lockfilePackages?: PackageSnapshots | undefined;
    lockfileDir: string;
  },
  project: {
    dir: string;
    manifest?: ProjectManifest | undefined;
    snapshot?: ProjectSnapshot | undefined;
  }
): Promise<boolean> {
  return pEvery.default(
    DEPENDENCIES_FIELDS,
    (depField: 'optionalDependencies' | 'dependencies' | 'devDependencies') => {
      const lockfileDeps = project.snapshot?.[depField];
      const manifestDeps = project.manifest?.[depField];

      if (
        typeof lockfileDeps === 'undefined' ||
        typeof manifestDeps === 'undefined'
      ) {
        return true;
      }

      const depNames = Object.keys(lockfileDeps);

      return pEvery.default(
        depNames,
        async (depName: string): Promise<boolean> => {
          const currentSpec = manifestDeps[depName];

          if (typeof currentSpec === 'undefined') {
            return true;
          }

          const lockfileRef = lockfileDeps[depName];

          if (typeof lockfileRef === 'undefined') {
            return true;
          }

          const specifier = project.snapshot?.specifiers[depName];

          if (typeof specifier === 'undefined') {
            return true;
          }

          if (refIsLocalDirectory(specifier)) {
            const depPath = refToRelative(lockfileRef, depName);
            return (
              depPath != null &&
              isLocalFileDepUpdated(lockfileDir, lockfilePackages?.[depPath])
            );
          }

          const isLinked = lockfileRef.startsWith('link:') === true;

          if (
            isLinked &&
            (currentSpec.startsWith('link:') ||
              currentSpec.startsWith('file:') ||
              currentSpec.startsWith('workspace:.'))
          ) {
            return true;
          }

          // https://github.com/pnpm/pnpm/issues/6592
          // if the dependency is linked and the specified version type is tag, we consider it to be up-to-date to skip full resolution.
          if (isLinked && getVersionSelectorType(currentSpec)?.type === 'tag') {
            return true;
          }

          const linkedDir = isLinked
            ? path.join(project.dir, lockfileRef.slice(5))
            : workspacePackages?.get(depName)?.get(lockfileRef)?.rootDir;

          if (typeof linkedDir === 'undefined') {
            return true;
          }

          if (!linkWorkspacePackages && !currentSpec.startsWith('workspace:')) {
            // we found a linked dir, but we don't want to use it, because it's not specified as a
            // workspace:x.x.x dependency
            return true;
          }

          const linkedPkg =
            manifestsByDir[linkedDir] ??
            (await safeReadPackageJsonFromDir(linkedDir));

          const availableRange = getVersionRange(currentSpec);

          // This should pass the same options to semver as @pnpm/npm-resolver
          const localPackageSatisfiesRange =
            availableRange === '*' ||
            availableRange === '^' ||
            availableRange === '~' ||
            (linkedPkg &&
              semver.satisfies(linkedPkg.version, availableRange, {
                loose: true,
              }));

          if (isLinked !== localPackageSatisfiesRange) {
            return false;
          }

          return true;
        }
      );
    }
  );
}

async function isLocalFileDepUpdated(
  lockfileDir: string,
  pkgSnapshot: PackageSnapshot | undefined
): Promise<boolean> {
  if (typeof pkgSnapshot === 'undefined') {
    return false;
  }

  const dir =
    typeof pkgSnapshot.resolution !== 'undefined' &&
    'directory' in pkgSnapshot.resolution
      ? pkgSnapshot.resolution.directory
      : undefined;

  if (typeof dir === 'undefined') {
    return false;
  }

  const localDepDir = path.join(lockfileDir, dir);

  const manifest = await safeReadPackageJsonFromDir(localDepDir);

  if (manifest === null) {
    return false;
  }

  for (const depField of DEPENDENCIES_OR_PEER_FIELDS) {
    if (depField === 'devDependencies') {
      continue;
    }

    const manifestDeps = manifest[depField] ?? {};

    const lockfileDeps = pkgSnapshot[depField] ?? {};

    // Lock file has more dependencies than the current manifest, e.g. some dependencies are removed.
    if (
      Object.keys(lockfileDeps).some((depName: string): boolean => {
        return typeof manifestDeps[depName] === 'undefined';
      })
    ) {
      return false;
    }

    for (const depName of Object.keys(manifestDeps)) {
      // If a dependency does not exist in the lock file, e.g. a new dependency is added to the current manifest.
      // We need to do full resolution again.
      if (typeof lockfileDeps[depName] === 'undefined') {
        return false;
      }
      const currentSpec = manifestDeps[depName];
      // We do not care about the link dependencies of local dependency.
      if (
        typeof currentSpec === 'undefined' ||
        currentSpec.startsWith('file:') === true ||
        currentSpec.startsWith('link:') === true ||
        currentSpec.startsWith('workspace:') === true
      ) {
        continue;
      }

      if (
        semver.satisfies(lockfileDeps[depName], getVersionRange(currentSpec), {
          loose: true,
        })
      ) {
        continue;
      }

      return false;
    }
  }

  return true;
}

function getVersionRange(spec: string): string {
  let newSpec = spec;

  if (newSpec.startsWith('workspace:')) {
    return newSpec.slice(10);
  }

  if (newSpec.startsWith('npm:')) {
    newSpec = newSpec.slice(4);

    const index = newSpec.indexOf('@', 1);

    if (index === -1) {
      return '*';
    }

    return newSpec.slice(index + 1) || '*';
  }

  return newSpec;
}
