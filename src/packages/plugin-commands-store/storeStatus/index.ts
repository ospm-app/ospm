import path from 'node:path';
import {
  getIndexFilePathInCafs,
  type PackageFilesIndex,
} from '../../store.cafs/index.ts';
import { getContextForSingleImporter } from '../../get-context/index.ts';
import {
  nameVerFromPkgSnapshot,
  packageIdFromSnapshot,
} from '../../lockfile.utils/index.ts';
import { streamParser } from '../../logger/index.ts';
import * as dp from '../../dependency-path/index.ts';
import type {
  DepPath,
  ModulesDir,
  PkgId,
  PkgResolutionId,
} from '../../types/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import dint from 'dint';
import { loadJsonFile } from 'load-json-file';
import pFilter from 'p-filter';
import {
  extendStoreStatusOptions,
  type StoreStatusOptions,
} from './extendStoreStatusOptions.ts';
import type { PackageSnapshot } from '../../lockfile.types/index.ts';
import type { TarballResolution } from '../../resolver-base/index.ts';

export async function storeStatus(
  maybeOpts: StoreStatusOptions
): Promise<string[]> {
  const reporter = maybeOpts.reporter;

  if (typeof reporter === 'function') {
    streamParser.on('data', reporter);
  }

  const opts = await extendStoreStatusOptions(maybeOpts);

  const { storeDir, skipped, virtualStoreDir, wantedLockfile } =
    await getContextForSingleImporter(
      {
        name: '',
        version: '',
      },
      {
        ...opts,
        lockfileDir: opts.lockfileDir,
        modulesDir: 'node_modules' as ModulesDir,
        extraBinPaths: [], // ctx.extraBinPaths is not needed, so this is fine
      }
    );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
  if (!wantedLockfile) {
    return [];
  }

  const pkgs = (
    Object.entries(wantedLockfile.packages ?? {}) as Array<
      [DepPath, PackageSnapshot]
    >
  )
    .filter(([depPath]: [DepPath, PackageSnapshot]): boolean => {
      return !skipped.has(depPath);
    })
    .map(
      ([depPath, pkgSnapshot]: [DepPath, PackageSnapshot]): {
        name: string;
        peersSuffix: string;
        version: string;
        nonSemverVersion?: PkgResolutionId | undefined;
        depPath: DepPath;
        id: PkgId;
        integrity: string | undefined;
        pkgPath: DepPath;
      } => {
        const id = packageIdFromSnapshot(depPath, pkgSnapshot);

        return {
          depPath,
          id,
          integrity: (pkgSnapshot.resolution as TarballResolution).integrity,
          pkgPath: depPath,
          ...nameVerFromPkgSnapshot(depPath, pkgSnapshot),
        };
      }
    );

  const modified = await pFilter(
    pkgs,
    async ({
      id,
      integrity,
      depPath,
      name,
    }: {
      name: string;
      peersSuffix: string;
      version: string;
      nonSemverVersion?: PkgResolutionId | undefined;
      depPath: DepPath;
      id: PkgId;
      integrity: string | undefined;
      pkgPath: DepPath;
    }): Promise<boolean> => {
      const pkgIndexFilePath =
        typeof integrity === 'string'
          ? getIndexFilePathInCafs(storeDir, integrity, id)
          : path.join(
              storeDir,
              dp.depPathToFilename(id, maybeOpts.virtualStoreDirMaxLength),
              'integrity.json'
            );

      const { files } = await loadJsonFile<PackageFilesIndex>(pkgIndexFilePath);

      return (
        (await dint.check(
          path.join(
            virtualStoreDir,
            dp.depPathToFilename(depPath, maybeOpts.virtualStoreDirMaxLength),
            'node_modules',
            name
          ),
          files
        )) === false
      );
    },
    { concurrency: 8 }
  );

  if (reporter != null && typeof reporter === 'function') {
    streamParser.removeListener('data', reporter);
  }

  return modified.map(
    ({
      pkgPath,
    }: {
      name: string;
      peersSuffix: string;
      version: string;
      nonSemverVersion?: PkgResolutionId | undefined;
      depPath: DepPath;
      id: PkgId;
      integrity: string | undefined;
      pkgPath: DepPath;
    }): DepPath => {
      return pkgPath;
    }
  );
}
