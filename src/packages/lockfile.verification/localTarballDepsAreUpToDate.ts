import { getTarballIntegrity } from '../crypto.hash/index.ts';
import { refToRelative } from '../dependency-path/index.ts';
import type {
  ProjectSnapshot,
  PackageSnapshots,
} from '../lockfile.types/index.ts';
import { refIsLocalTarball } from '../lockfile.utils/index.ts';
import { DEPENDENCIES_FIELDS } from '../types/index.ts';
import path from 'node:path';
import pEvery from 'p-every';
import type { TarballResolution } from '../resolver-base/index.ts';

export type LocalTarballDepsUpToDateContext = {
  /**
   * Local cache of local absolute file paths to their integrity. Expected to be
   * initialized to an empty map by the caller.
   */
  readonly fileIntegrityCache: Map<string, Promise<string>>;
  readonly lockfilePackages?: PackageSnapshots | undefined;
  readonly lockfileDir: string;
};

/**
 * Returns false if a local tarball file has been changed on disk since the last
 * installation recorded by the project snapshot.
 *
 * This function only inspects the project's lockfile snapshot. It does not
 * inspect the current project manifest. The caller of this function is expected
 * to handle changes to the project manifest that would cause the corresponding
 * project snapshot to become out of date.
 */
export async function localTarballDepsAreUpToDate(
  {
    fileIntegrityCache,
    lockfilePackages,
    lockfileDir,
  }: LocalTarballDepsUpToDateContext,
  project: {
    snapshot: ProjectSnapshot;
  }
): Promise<boolean> {
  return pEvery.default(
    DEPENDENCIES_FIELDS,
    (depField: 'optionalDependencies' | 'dependencies' | 'devDependencies') => {
      const lockfileDeps = project.snapshot[depField];

      // If the lockfile is missing a snapshot for this project's dependencies, we
      // can return true. The "satisfiesPackageManifest" logic in
      // "allProjectsAreUpToDate" will catch mismatches between a project's
      // manifest and snapshot dependencies size.
      if (lockfileDeps == null) {
        return true;
      }

      return pEvery.default(
        Object.entries(lockfileDeps),
        async ([depName, ref]: [string, string]): Promise<boolean> => {
          if (!refIsLocalTarball(ref)) {
            return true;
          }

          const depPath = refToRelative(ref, depName);

          const packageSnapshot =
            depPath != null ? lockfilePackages?.[depPath] : null;

          // If there's no snapshot for this local tarball yet, the project is out
          // of date and needs to be resolved. This should only happen with a
          // broken lockfile.
          if (packageSnapshot == null) {
            return false;
          }

          const filePath = path.join(lockfileDir, ref.slice('file:'.length));

          const fileIntegrityPromise =
            fileIntegrityCache.get(filePath) ?? getTarballIntegrity(filePath);
          if (!fileIntegrityCache.has(filePath)) {
            fileIntegrityCache.set(filePath, fileIntegrityPromise);
          }

          let fileIntegrity: string;
          try {
            fileIntegrity = await fileIntegrityPromise;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
          } catch (_err: any) {
            // If there was an error reading the tarball, assume the lockfile is
            // out of date. The full resolution process will emit a clearer error
            // later during install.
            return false;
          }

          return (
            (packageSnapshot.resolution as TarballResolution).integrity ===
            fileIntegrity
          );
        }
      );
    }
  );
}
