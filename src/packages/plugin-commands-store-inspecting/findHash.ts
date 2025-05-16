import path from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';

import type { Config } from '../config/index.ts';
import { OspmError } from '../error/index.ts';
import { getStorePath } from '../store-path/index.ts';
import type { PackageFilesIndex } from '../store.cafs/index.ts';

import { loadJsonFileSync } from 'load-json-file';
import renderHelp from 'render-help';

export const PACKAGE_INFO_CLR = chalk.greenBright;
export const INDEX_PATH_CLR = chalk.hex('#078487');

export const skipPackageManagerCheck = true;

export const commandNames = ['find-hash'];

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export function help(): string {
  return renderHelp({
    description:
      'Experimental! Lists the packages that include the file with the specified hash.',
    descriptionLists: [],
    usages: ['ospm find-hash <hash>'],
  });
}

export type FindHashCommandOptions = Pick<Config, 'storeDir' | 'ospmHomeDir'>;

export type FindHashResult = {
  name: string;
  version: string;
  filesIndexFile: string;
};

export async function handler(
  opts: FindHashCommandOptions,
  params: string[]
): Promise<string> {
  if (params.length === 0) {
    throw new OspmError('MISSING_HASH', '`ospm find-hash` requires the hash');
  }

  const hash = params[0];

  const storeDir = await getStorePath({
    pkgRoot: process.cwd(),
    storePath: opts.storeDir,
    ospmHomeDir: opts.ospmHomeDir,
  });

  const indexDir = path.join(storeDir, 'index');

  const cafsChildrenDirs = fs
    .readdirSync(indexDir, { withFileTypes: true })
    .filter((file: fs.Dirent): boolean => {
      return file.isDirectory();
    });

  const indexFiles: string[] = [];

  const result: FindHashResult[] = [];

  for (const { name: dirName } of cafsChildrenDirs) {
    const dirIndexFiles = fs
      .readdirSync(`${indexDir}/${dirName}`)
      .filter((fileName: string): boolean => {
        return fileName.includes('.json');
      })
      .map((fileName: string): string => {
        return `${indexDir}/${dirName}/${fileName}`;
      });

    indexFiles.push(...dirIndexFiles);
  }

  for (const filesIndexFile of indexFiles) {
    const pkgFilesIndex = loadJsonFileSync<PackageFilesIndex>(filesIndexFile);

    for (const [, file] of Object.entries(pkgFilesIndex.files)) {
      if (file.integrity === hash) {
        result.push({
          name: pkgFilesIndex.name ?? 'unknown',
          version: pkgFilesIndex.version ?? 'unknown',
          filesIndexFile: filesIndexFile.replace(indexDir, ''),
        });

        // a package is only found once.
        // continue;
      }
    }

    if (pkgFilesIndex.sideEffects) {
      for (const { added } of Object.values(pkgFilesIndex.sideEffects)) {
        if (!added) {
          continue;
        }

        for (const file of Object.values(added)) {
          if (file.integrity === hash) {
            result.push({
              name: pkgFilesIndex.name ?? 'unknown',
              version: pkgFilesIndex.version ?? 'unknown',
              filesIndexFile: filesIndexFile.replace(indexDir, ''),
            });

            // a package is only found once.
            // continue;
          }
        }
      }
    }
  }

  if (!result.length) {
    throw new OspmError(
      'INVALID_FILE_HASH',
      'No package or index file matching this hash was found.'
    );
  }

  let acc = '';

  for (const { name, version, filesIndexFile } of result) {
    acc += `${PACKAGE_INFO_CLR(name)}@${PACKAGE_INFO_CLR(version)}  ${INDEX_PATH_CLR(filesIndexFile)}\n`;
  }

  return acc;
}
