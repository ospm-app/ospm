import type {
  AddToStoreResult,
  FilesIndex,
  FileWriteResult,
} from '../cafs-types/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import isGzip from 'is-gzip';
import { gunzipSync } from 'node:zlib';
import { parseJsonBufferSync } from './parseJson.ts';
import { parseTarball } from './parseTarball.ts';

export function addFilesFromTarball(
  addBufferToCafs: (buffer: Buffer, mode: number) => FileWriteResult,
  _ignore: null | ((filename: string) => boolean),
  tarballBuffer: Buffer,
  readManifest?: boolean
): AddToStoreResult {
  const ignore = _ignore ?? (() => false);

  const tarContent =
    isGzip(tarballBuffer) === true
      ? gunzipSync(tarballBuffer)
      : Buffer.isBuffer(tarballBuffer)
        ? tarballBuffer
        : Buffer.from(tarballBuffer);

  const { files } = parseTarball(tarContent);

  const filesIndex: FilesIndex = {};

  let manifestBuffer: Buffer | undefined;

  for (const [relativePath, { mode, offset, size }] of files) {
    if (ignore(relativePath)) {
      continue;
    }

    const fileBuffer = tarContent.slice(offset, offset + size);

    if (readManifest === true && relativePath === 'package.json') {
      manifestBuffer = fileBuffer;
    }

    filesIndex[relativePath] = {
      mode,
      size,
      ...addBufferToCafs(fileBuffer, mode),
    };
  }

  return {
    filesIndex,
    manifest: manifestBuffer
      ? (parseJsonBufferSync(manifestBuffer) as DependencyManifest)
      : undefined,
  };
}
