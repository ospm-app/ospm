import assert from 'node:assert';
import fs from 'node:fs/promises';
import util from 'node:util';
import type { FetchFunction, FetchOptions } from '../fetcher-base/index.ts';
import type { Cafs, PackageFiles } from '../cafs-types/index.ts';
import { packlist } from '../fs.packlist/index.ts';
import { globalWarn } from '../logger/index.ts';
import { preparePackage } from '../prepare-package/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import { addFilesFromDir, type AddFilesResult } from '../worker/index.ts';
import renameOverwrite from 'rename-overwrite';
import { fastPathTemp as pathTemp } from 'path-temp';
import type { Resolution } from '../resolver-base/index.ts';

export type CreateGitHostedTarballFetcher = {
  ignoreScripts?: boolean | undefined;
  rawConfig: Record<string, string>;
  unsafePerm?: boolean | undefined;
};

export function createGitHostedTarballFetcher(
  fetchRemoteTarball: FetchFunction<Resolution, FetchOptions, AddFilesResult>,
  fetcherOpts: CreateGitHostedTarballFetcher
): FetchFunction<
  Resolution,
  FetchOptions,
  {
    filesIndex: PackageFiles | Record<string, string>;
    manifest: DependencyManifest | undefined;
    requiresBuild: boolean;
  }
> {
  return async (
    cafs: Cafs,
    resolution: Resolution,
    opts: FetchOptions
  ): Promise<{
    filesIndex: PackageFiles | Record<string, string>;
    manifest: DependencyManifest | undefined;
    requiresBuild: boolean;
  }> => {
    const tempIndexFile = pathTemp(opts.filesIndexFile);

    const { filesIndex, manifest, requiresBuild } = await fetchRemoteTarball(
      cafs,
      resolution,
      {
        ...opts,
        filesIndexFile: tempIndexFile,
      }
    );

    try {
      const prepareResult = await prepareGitHostedPkg<Record<string, string>>(
        filesIndex,
        cafs,
        tempIndexFile,
        opts.filesIndexFile,
        fetcherOpts,
        opts,
        resolution
      );

      if (prepareResult.ignoredBuild) {
        globalWarn(
          `The git-hosted package fetched from "${resolution.tarball}" has to be built but the build scripts were ignored.`
        );
      }

      return {
        filesIndex: prepareResult.filesIndex,
        manifest: prepareResult.manifest ?? manifest,
        requiresBuild,
      };
    } catch (err: unknown) {
      assert(util.types.isNativeError(err));

      err.message = `Failed to prepare git-hosted package fetched from "${resolution.tarball}": ${err.message}`;

      throw err;
    }
  };
}

type PrepareGitHostedPkgResult = {
  filesIndex: PackageFiles | Record<string, string>;
  manifest?: DependencyManifest | undefined;
  ignoredBuild: boolean;
};

async function prepareGitHostedPkg<PF extends Record<string, string>>(
  filesIndex: PF, // Record<string, string>,
  cafs: Cafs,
  filesIndexFileNonBuilt: string,
  filesIndexFile: string,
  opts: CreateGitHostedTarballFetcher,
  fetcherOpts: FetchOptions,
  resolution: Resolution
): Promise<PrepareGitHostedPkgResult> {
  const tempLocation = await cafs.tempDir();

  cafs.importPackage(tempLocation, {
    filesResponse: {
      unprocessed: false,
      filesIndex,
      resolvedFrom: 'remote',
      requiresBuild: false,
    },
    force: true,
  });

  if ('path' in resolution) {
    const { shouldBeBuilt, pkgDir } = await preparePackage(
      opts,
      tempLocation,
      resolution.path
    );

    const files = await packlist(pkgDir);

    if (
      typeof resolution.path === 'string' &&
      files.length === Object.keys(filesIndex).length
    ) {
      if (shouldBeBuilt !== true) {
        if (filesIndexFileNonBuilt !== filesIndexFile) {
          await renameOverwrite(filesIndexFileNonBuilt, filesIndexFile);
        }

        return {
          filesIndex,
          ignoredBuild: false,
        };
      }

      if (opts.ignoreScripts === true) {
        return {
          filesIndex,
          ignoredBuild: true,
        };
      }
    }

    try {
      // The temporary index file may be deleted
      await fs.unlink(filesIndexFileNonBuilt);
    } catch {}
    // Important! We cannot remove the temp location at this stage.
    // Even though we have the index of the package,
    // the linking of files to the store is in progress.
    return {
      ...(await addFilesFromDir({
        storeDir: cafs.storeDir,
        dir: pkgDir,
        files,
        filesIndexFile,
        pkg: fetcherOpts.pkg,
        readManifest: fetcherOpts.readManifest,
      })),
      ignoredBuild: Boolean(opts.ignoreScripts),
    };
  }

  return {
    filesIndex,
    ignoredBuild: Boolean(opts.ignoreScripts),
  };
}
