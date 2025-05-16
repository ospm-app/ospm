import { existsSync } from 'node:fs';
import path from 'node:path';
import { getTarballIntegrity } from '../crypto.hash/index.ts';
import { OspmError } from '../error/index.ts';
import { readProjectManifestOnly } from '../read-project-manifest/index.ts';
import type {
  DirectoryResolution,
  GenericTarballResolution,
  ResolveResult,
  TarballResolution,
} from '../resolver-base/index.ts';
import type { DependencyManifest, LockFileDir } from '../types/index.ts';
import { logger } from '../logger/index.ts';
import { parsePref, type WantedLocalDependency } from './parsePref.ts';

export type { WantedLocalDependency };

export interface ResolveFromLocalResult extends ResolveResult {
  normalizedPref: string;
  resolution:
    | TarballResolution
    | DirectoryResolution
    | GenericTarballResolution;
  manifest?: DependencyManifest | undefined;
}

/**
 * Resolves a package hosted on the local filesystem
 */
export async function resolveFromLocal(
  wantedDependency: WantedLocalDependency,
  opts: {
    lockfileDir?: LockFileDir | undefined;
    projectDir: string;
  }
): Promise<ResolveFromLocalResult | null> {
  const spec = parsePref(
    wantedDependency,
    opts.projectDir,
    opts.lockfileDir ?? opts.projectDir
  );

  if (spec == null) {
    return null;
  }

  const resolution = {
    integrity: await getTarballIntegrity(spec.fetchSpec),
    tarball: spec.id,
  };

  if (spec.type === 'file') {
    return {
      id: spec.id,
      normalizedPref: spec.normalizedPref,
      resolution,
      resolvedVia: 'local-filesystem',
    };
  }

  let localDependencyManifest!: DependencyManifest;

  try {
    localDependencyManifest = await readProjectManifestOnly(spec.fetchSpec);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (internalErr: any) {
    if (existsSync(spec.fetchSpec)) {
      switch (internalErr.code) {
        case 'ENOTDIR': {
          throw new OspmError(
            'NOT_PACKAGE_DIRECTORY',
            `Could not install from "${spec.fetchSpec}" as it is not a directory.`
          );
        }

        case 'ERR_OSPM_NO_IMPORTER_MANIFEST_FOUND':
        case 'ENOENT': {
          localDependencyManifest = {
            name: path.basename(spec.fetchSpec),
            version: '0.0.0',
          };

          break;
        }

        default: {
          throw internalErr;
        }
      }
    } else {
      if (spec.id.startsWith('file:') === true) {
        throw new OspmError(
          'LINKED_PKG_DIR_NOT_FOUND',
          `Could not install from "${spec.fetchSpec}" as it does not exist.`
        );
      }

      logger.warn({
        message: `Installing a dependency from a non-existent directory: ${spec.fetchSpec}`,
        prefix: opts.projectDir,
      });

      localDependencyManifest = {
        name: path.basename(spec.fetchSpec),
        version: '0.0.0',
      };
    }
  }

  return {
    id: spec.id,
    manifest: localDependencyManifest,
    normalizedPref: spec.normalizedPref,
    resolution: {
      directory: spec.dependencyPath,
      type: 'directory',
    },
    resolvedVia: 'local-filesystem',
  };
}
