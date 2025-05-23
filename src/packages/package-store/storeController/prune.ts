import { type Dirent, promises as fs } from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import type { PackageFilesIndex } from '../../store.cafs/index.ts';
import { globalInfo, globalWarn } from '../../logger/index.ts';
import rimraf from '@zkochan/rimraf';
import { loadJsonFile } from 'load-json-file';
import ssri from 'ssri';

const BIG_ONE = BigInt(1) as unknown;

export type PruneOptions = {
  cacheDir: string;
  storeDir: string;
};

export async function prune(
  { cacheDir, storeDir }: PruneOptions,
  removeAlienFiles?: boolean | undefined
): Promise<void> {
  const cafsDir = path.join(storeDir, 'files');

  const metadataDirs = await getSubdirsSafely(cacheDir);

  await Promise.all(
    metadataDirs.map(async (metadataDir: string): Promise<void> => {
      if (!metadataDir.startsWith('metadata')) {
        return;
      }

      try {
        await rimraf(path.join(cacheDir, metadataDir));
      } catch (err: unknown) {
        if (
          !(
            util.types.isNativeError(err) &&
            'code' in err &&
            err.code === 'ENOENT'
          )
        ) {
          throw err;
        }
      }
    })
  );

  await rimraf(path.join(storeDir, 'tmp'));

  globalInfo('Removed all cached metadata files');

  const pkgIndexFiles: string[] = [];

  const indexDir = path.join(storeDir, 'index');

  await Promise.all(
    (await getSubdirsSafely(indexDir)).map(
      async (dir: string): Promise<void> => {
        const subdir = path.join(indexDir, dir);

        await Promise.all(
          (await fs.readdir(subdir)).map(async (fileName) => {
            const filePath = path.join(subdir, fileName);

            if (fileName.endsWith('.json')) {
              pkgIndexFiles.push(filePath);
            }
          })
        );
      }
    )
  );

  const removedHashes = new Set<string>();

  const dirs = await getSubdirsSafely(cafsDir);

  let fileCounter = 0;

  await Promise.all(
    dirs.map(async (dir: string): Promise<void> => {
      const subdir = path.join(cafsDir, dir);

      await Promise.all(
        (await fs.readdir(subdir)).map(
          async (fileName: string): Promise<void> => {
            const filePath = path.join(subdir, fileName);

            if (fileName.endsWith('.json')) {
              pkgIndexFiles.push(filePath);
              return;
            }

            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
              if (removeAlienFiles === true) {
                await rimraf(filePath);

                globalWarn(
                  `An alien directory has been removed from the store: ${filePath}`
                );

                fileCounter++;

                return;
              }

              globalWarn(
                `An alien directory is present in the store: ${filePath}`
              );

              return;
            }

            if (stat.nlink === 1 || stat.nlink === BIG_ONE) {
              await fs.unlink(filePath);

              fileCounter++;

              removedHashes.add(
                ssri.fromHex(`${dir}${fileName}`, 'sha512').toString()
              );
            }
          }
        )
      );
    })
  );

  globalInfo(`Removed ${fileCounter} file${fileCounter === 1 ? '' : 's'}`);

  let pkgCounter = 0;

  await Promise.all(
    pkgIndexFiles.map(async (pkgIndexFilePath: string): Promise<void> => {
      const { files: pkgFilesIndex } =
        await loadJsonFile<PackageFilesIndex>(pkgIndexFilePath);

      const integrity = pkgFilesIndex['package.json']?.integrity;

      if (
        typeof integrity === 'string' &&
        removedHashes.has(integrity) === true
      ) {
        await fs.unlink(pkgIndexFilePath);

        pkgCounter++;
      }
    })
  );

  globalInfo(`Removed ${pkgCounter} package${pkgCounter === 1 ? '' : 's'}`);
}

async function getSubdirsSafely(dir: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return [];
    }
    throw err;
  }

  return entries
    .filter((entry: Dirent): boolean => {
      return entry.isDirectory();
    })
    .map((dir: Dirent): string => {
      return dir.name;
    });
}
