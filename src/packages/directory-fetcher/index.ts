import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { pkgRequiresBuild } from '../exec.pkg-requires-build/index.ts';
import type {
  DirectoryFetcher,
  DirectoryFetcherOptions,
} from '../fetcher-base/index.ts';
import { logger } from '../logger/index.ts';
import { packlist } from '../fs.packlist/index.ts';
import { safeReadProjectManifestOnly } from '../read-project-manifest/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import type { Cafs } from '../cafs-types/index.ts';
import type { DirectoryResolution } from '../resolver-base/index.ts';

const directoryFetcherLogger = logger('directory-fetcher');

export type CreateDirectoryFetcherOptions = {
  includeOnlyPackageFiles?: boolean | undefined;
  resolveSymlinks?: boolean | undefined;
};

export function createDirectoryFetcher(
  opts?: CreateDirectoryFetcherOptions | undefined
): {
  directory: DirectoryFetcher;
} {
  const readFileStat: ReadFileStat =
    opts?.resolveSymlinks === true ? realFileStat : fileStat;

  const fetchFromDir =
    opts?.includeOnlyPackageFiles === true
      ? fetchPackageFilesFromDir
      : fetchAllFilesFromDir.bind(null, readFileStat);

  const directoryFetcher: DirectoryFetcher = (
    _cafs: Cafs,
    resolution: DirectoryResolution,
    opts: DirectoryFetcherOptions
  ): Promise<FetchResult> => {
    const dir = path.join(opts.lockfileDir, resolution.directory);

    return fetchFromDir(dir);
  };

  return {
    directory: directoryFetcher,
  };
}

export type FetchFromDirOptions = Omit<DirectoryFetcherOptions, 'lockfileDir'> &
  CreateDirectoryFetcherOptions;

export type FetchResult = {
  local: true;
  filesIndex: Record<string, string>;
  filesStats?: Record<string, Stats | null> | undefined;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'clone-or-copy'
    | 'copy'
    | 'clone'
    | undefined;
  manifest?: DependencyManifest | undefined;
  requiresBuild: boolean;
};

export async function fetchFromDir(
  dir: string,
  opts: FetchFromDirOptions
): Promise<FetchResult> {
  if (opts.includeOnlyPackageFiles === true) {
    return fetchPackageFilesFromDir(dir);
  }
  const readFileStat: ReadFileStat =
    opts.resolveSymlinks === true ? realFileStat : fileStat;
  return fetchAllFilesFromDir(readFileStat, dir);
}

async function fetchAllFilesFromDir(
  readFileStat: ReadFileStat,
  dir: string
): Promise<FetchResult> {
  const { filesIndex, filesStats } = await _fetchAllFilesFromDir(
    readFileStat,
    dir
  );
  // In a regular ospm workspace it will probably never happen that a dependency has no package.json file.
  // Safe read was added to support the Bit workspace in which the components have no package.json files.
  // Related PR in Bit: https://github.com/teambit/bit/pull/5251
  const manifest = (await safeReadProjectManifestOnly(dir)) ?? undefined;
  const requiresBuild = pkgRequiresBuild(manifest, filesIndex);

  return {
    local: true,
    filesIndex,
    filesStats,
    packageImportMethod: 'hardlink',
    manifest,
    requiresBuild,
  };
}

async function _fetchAllFilesFromDir(
  readFileStat: ReadFileStat,
  dir: string,
  relativeDir = ''
): Promise<Pick<FetchResult, 'filesIndex' | 'filesStats'>> {
  const filesIndex: Record<string, string> = {};
  const filesStats: Record<string, Stats | null> = {};
  const files = await fs.readdir(dir);
  await Promise.all(
    files
      .filter((file) => file !== 'node_modules')
      .map(async (file) => {
        const fileStatResult = await readFileStat(path.join(dir, file));
        if (!fileStatResult) return;
        const { filePath, stat } = fileStatResult;
        const relativeSubdir = `${relativeDir}${relativeDir ? '/' : ''}${file}`;
        if (stat.isDirectory()) {
          const subFetchResult = await _fetchAllFilesFromDir(
            readFileStat,
            filePath,
            relativeSubdir
          );
          Object.assign(filesIndex, subFetchResult.filesIndex);
          Object.assign(filesStats, subFetchResult.filesStats);
        } else {
          filesIndex[relativeSubdir] = filePath;
          filesStats[relativeSubdir] = fileStatResult.stat;
        }
      })
  );
  return { filesIndex, filesStats };
}

type FileStatResult = {
  filePath: string;
  stat: Stats;
};

type ReadFileStat = (filePath: string) => Promise<FileStatResult | null>;

async function realFileStat(filePath: string): Promise<FileStatResult | null> {
  let stat = await fs.lstat(filePath);

  if (!stat.isSymbolicLink()) {
    return { filePath, stat };
  }

  let newFilePath = filePath;

  try {
    newFilePath = await fs.realpath(newFilePath);
    stat = await fs.stat(newFilePath);
    return { filePath: newFilePath, stat };
  } catch (err: unknown) {
    // Broken symlinks are skipped
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      directoryFetcherLogger.debug({ brokenSymlink: newFilePath });
      return null;
    }

    throw err;
  }
}

async function fileStat(filePath: string): Promise<FileStatResult | null> {
  try {
    return {
      filePath,
      stat: await fs.stat(filePath),
    };
  } catch (err: unknown) {
    // Broken symlinks are skipped
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      directoryFetcherLogger.debug({ brokenSymlink: filePath });
      return null;
    }
    throw err;
  }
}

async function fetchPackageFilesFromDir(dir: string): Promise<FetchResult> {
  const files = await packlist(dir);
  const filesIndex: Record<string, string> = Object.fromEntries(
    files.map((file) => [file, path.join(dir, file)])
  );
  // In a regular ospm workspace it will probably never happen that a dependency has no package.json file.
  // Safe read was added to support the Bit workspace in which the components have no package.json files.
  // Related PR in Bit: https://github.com/teambit/bit/pull/5251
  const manifest = (await safeReadProjectManifestOnly(dir)) ?? undefined;
  const requiresBuild = pkgRequiresBuild(manifest, filesIndex);
  return {
    local: true,
    filesIndex,
    packageImportMethod: 'hardlink',
    manifest,
    requiresBuild,
  };
}
