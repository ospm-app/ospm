import type {
  AddToStoreResult,
  FileWriteResult,
  PackageFiles,
  PackageFileInfo,
  FilesIndex,
} from '../cafs-types/index.ts';
import ssri from 'ssri';
import { addFilesFromDir } from './addFilesFromDir.ts';
import { addFilesFromTarball } from './addFilesFromTarball.ts';
import {
  checkPkgFilesIntegrity,
  type PackageFilesIndex,
  type VerifyResult,
} from './checkPkgFilesIntegrity.ts';
import { readManifestFromStore } from './readManifestFromStore.ts';
import {
  getIndexFilePathInCafs,
  contentPathFromHex,
  type FileType,
  getFilePathByModeInCafs,
  modeIsExecutable,
} from './getFilePathInCafs.ts';
import {
  optimisticRenameOverwrite,
  writeBufferToCafs,
} from './writeBufferToCafs.ts';

export type { IntegrityLike } from 'ssri';

export {
  checkPkgFilesIntegrity,
  readManifestFromStore,
  type FileType,
  getFilePathByModeInCafs,
  getIndexFilePathInCafs,
  type PackageFileInfo,
  type PackageFiles,
  type PackageFilesIndex,
  optimisticRenameOverwrite,
  type FilesIndex,
  type VerifyResult,
};

export type CafsLocker = Map<string, number>;

export interface CreateCafsOpts {
  ignoreFile?: ((filename: string) => boolean) | undefined;
  cafsLocker?: CafsLocker | undefined;
}

export interface CafsFunctions {
  addFilesFromDir: (
    dirname: string,
    opts?:
      | { files?: string[] | undefined; readManifest?: boolean | undefined }
      | undefined
  ) => AddToStoreResult;
  addFilesFromTarball: (
    tarballBuffer: Buffer,
    readManifest?: boolean | undefined
  ) => AddToStoreResult;
  getIndexFilePathInCafs: (
    integrity: string | ssri.IntegrityLike,
    fileType: FileType
  ) => string;
  getFilePathByModeInCafs: (
    integrity: string | ssri.IntegrityLike,
    mode: number
  ) => string;
}

export function createCafs(
  storeDir: string,
  { ignoreFile, cafsLocker }: CreateCafsOpts = {}
): CafsFunctions {
  const _writeBufferToCafs = writeBufferToCafs.bind(
    null,
    cafsLocker ?? new Map(),
    storeDir
  );
  const addBuffer = addBufferToCafs.bind(null, _writeBufferToCafs);
  return {
    addFilesFromDir: addFilesFromDir.bind(null, addBuffer),
    addFilesFromTarball: addFilesFromTarball.bind(
      null,
      addBuffer,
      ignoreFile ?? null
    ),
    getIndexFilePathInCafs: getIndexFilePathInCafs.bind(null, storeDir),
    getFilePathByModeInCafs: getFilePathByModeInCafs.bind(null, storeDir),
  };
}

type WriteBufferToCafs = (
  buffer: Buffer,
  fileDest: string,
  mode: number | undefined,
  integrity: ssri.IntegrityLike
) => { checkedAt: number; filePath: string };

function addBufferToCafs(
  writeBufferToCafs: WriteBufferToCafs,
  buffer: Buffer,
  mode: number
): FileWriteResult {
  // Calculating the integrity of the file is surprisingly fast.
  // 30K files are calculated in 1 second.
  // Hence, from a performance perspective, there is no win in fetching the package index file from the registry.
  const integrity = ssri.fromData(buffer);
  const isExecutable = modeIsExecutable(mode);
  const fileDest = contentPathFromHex(
    isExecutable ? 'exec' : 'nonexec',
    integrity.hexDigest()
  );
  const { checkedAt, filePath } = writeBufferToCafs(
    buffer,
    fileDest,
    isExecutable ? 0o755 : undefined,
    integrity
  );
  return { checkedAt, integrity, filePath };
}
