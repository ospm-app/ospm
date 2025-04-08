import util from 'node:util';
import fs, { type Stats } from 'node:fs';
import path from 'node:path';
import type {
  AddToStoreResult,
  FilesIndex,
  FileWriteResult,
} from '../cafs-types/index.ts';
import gfs from '../graceful-fs/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import { parseJsonBufferSync } from './parseJson.ts';

export function addFilesFromDir(
  addBuffer: (buffer: Buffer, mode: number) => FileWriteResult,
  dirname: string,
  opts: {
    files?: string[] | undefined;
    readManifest?: boolean | undefined;
  } = {}
): AddToStoreResult {
  const filesIndex: FilesIndex = {};

  let manifest: DependencyManifest | undefined;

  let files: File[];

  if (opts.files) {
    files = [];

    for (const file of opts.files) {
      const absolutePath = path.join(dirname, file);

      let stat: Stats;

      try {
        stat = fs.statSync(absolutePath);
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

        continue;
      }

      files.push({
        absolutePath,
        relativePath: file,
        stat,
      });
    }
  } else {
    files = findFilesInDir(dirname);
  }

  for (const { absolutePath, relativePath, stat } of files) {
    const buffer = gfs.readFileSync(absolutePath);
    if (opts.readManifest === true && relativePath === 'package.json') {
      manifest = parseJsonBufferSync(buffer) as DependencyManifest;
    }

    // Remove the file type information (regular file, directory, etc.) and leave just the permission bits (rwx for owner, group, and others)
    const mode = stat.mode & 0o7_7_7;

    filesIndex[relativePath] = {
      mode,
      size: stat.size,
      ...addBuffer(buffer, mode),
    };
  }

  return { manifest, filesIndex };
}

interface File {
  relativePath: string;
  absolutePath: string;
  stat: Stats;
}

function findFilesInDir(dir: string): File[] {
  const files: File[] = [];
  findFiles(files, dir);
  return files;
}

function findFiles(filesList: File[], dir: string, relativeDir = ''): void {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const relativeSubdir = `${relativeDir}${relativeDir ? '/' : ''}${file.name}`;

    if (file.isDirectory()) {
      if (relativeDir !== '' || file.name !== 'node_modules') {
        findFiles(filesList, path.join(dir, file.name), relativeSubdir);
      }

      continue;
    }

    const absolutePath = path.join(dir, file.name);

    let stat: Stats;

    try {
      stat = fs.statSync(absolutePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }

      continue;
    }

    if (stat.isDirectory()) {
      findFiles(filesList, path.join(dir, file.name), relativeSubdir);
      continue;
    }

    filesList.push({
      relativePath: relativeSubdir,
      absolutePath,
      stat,
    });
  }
}
