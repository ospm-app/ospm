import path from 'node:path';
import fs from 'node:fs';
import gfs from '../graceful-fs/index.ts';
import type {
  Cafs,
  PackageFiles,
  SideEffects,
  SideEffectsDiff,
} from '../cafs-types/index.ts';
import { createCafsStore } from '../create-cafs-store/index.ts';
import * as crypto from '../crypto.polyfill/index.ts';
import { pkgRequiresBuild } from '../exec.pkg-requires-build/index.ts';
import { hardLinkDir } from '../fs.hard-link-dir/index.ts';
import {
  type CafsFunctions,
  checkPkgFilesIntegrity,
  createCafs,
  type PackageFilesIndex,
  type FilesIndex,
  optimisticRenameOverwrite,
  readManifestFromStore,
  type VerifyResult,
} from '../store.cafs/index.ts';
import { symlinkDependencySync } from '../symlink-dependency/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import { loadJsonFile } from 'load-json-file';
import { parentPort } from 'node:worker_threads';
import type {
  AddDirToStoreMessage,
  ReadPkgFromCafsMessage,
  LinkPkgMessage,
  SymlinkAllModulesMessage,
  TarballExtractMessage,
  HardLinkDirMessage,
  InitStoreMessage,
} from './types.ts';
import process from 'node:process';

// eslint-disable-next-line optimize-regex/optimize-regex
const INTEGRITY_REGEX: RegExp = /^([^-]+)-([a-z0-9+/=]+)$/i;

parentPort?.on('message', handleMessage);

const cafsCache = new Map<string, CafsFunctions>();
const cafsStoreCache = new Map<string, Cafs>();
const cafsLocker = new Map<string, number>();

async function handleMessage(
  message:
    | TarballExtractMessage
    | LinkPkgMessage
    | AddDirToStoreMessage
    | ReadPkgFromCafsMessage
    | SymlinkAllModulesMessage
    | HardLinkDirMessage
    | InitStoreMessage
    | false
): Promise<void> {
  if (message === false) {
    parentPort?.off('message', handleMessage);

    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  }

  try {
    switch (message.type) {
      case 'extract': {
        parentPort?.postMessage(addTarballToStore(message));
        break;
      }

      case 'link': {
        parentPort?.postMessage(importPackage(message));
        break;
      }

      case 'add-dir': {
        parentPort?.postMessage(await addFilesFromDir(message));
        break;
      }

      case 'init-store': {
        parentPort?.postMessage(initStore(message));
        break;
      }

      case 'readPkgFromCafs': {
        let { storeDir, filesIndexFile, readManifest, verifyStoreIntegrity } =
          message;

        let pkgFilesIndex: PackageFilesIndex | undefined;

        try {
          pkgFilesIndex = await loadJsonFile<PackageFilesIndex>(filesIndexFile);
        } catch {
          // ignoring. It is fine if the integrity file is not present. Just refetch the package
        }

        if (!pkgFilesIndex) {
          parentPort?.postMessage({
            status: 'success',
            value: {
              verified: false,
              pkgFilesIndex: null,
            },
          });

          return;
        }

        let verifyResult: VerifyResult | undefined;

        if (pkgFilesIndex.requiresBuild == null) {
          readManifest = true;
        }

        if (verifyStoreIntegrity) {
          verifyResult = checkPkgFilesIntegrity(
            storeDir,
            pkgFilesIndex,
            readManifest
          );
        } else {
          verifyResult = {
            passed: true,
            manifest: readManifest
              ? readManifestFromStore(storeDir, pkgFilesIndex)
              : undefined,
          };
        }

        const requiresBuild =
          pkgFilesIndex.requiresBuild ??
          pkgRequiresBuild(verifyResult.manifest, pkgFilesIndex.files);

        parentPort?.postMessage({
          status: 'success',
          value: {
            verified: verifyResult.passed,
            manifest: verifyResult.manifest,
            pkgFilesIndex,
            requiresBuild,
          },
        });

        break;
      }

      case 'symlinkAllModules': {
        parentPort?.postMessage(symlinkAllModules(message));
        break;
      }

      case 'hardLinkDir': {
        hardLinkDir(message.src, message.destDirs);
        parentPort?.postMessage({ status: 'success' });
        break;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    parentPort?.postMessage({
      status: 'error',
      error: {
        code: e.code,
        message: e.message ?? e.toString(),
      },
    });
  }
}

function addTarballToStore({
  buffer,
  storeDir,
  integrity,
  filesIndexFile,
}: TarballExtractMessage):
  | {
      status: string;
      error: {
        type: string;
        expected: string;
        algorithm?: never;
        found?: never;
        storeDir?: never;
      };
      value?: never;
    }
  | {
      status: string;
      error: {
        type: string;
        algorithm: string;
        expected: string;
        found: string;
        storeDir?: never;
      };
      value?: never;
    }
  | {
      status: string;
      error: {
        type: string;
        storeDir: string;
        expected?: never;
        algorithm?: never;
        found?: never;
      };
      value?: never;
    }
  | {
      status: string;
      value: {
        filesIndex: Record<string, string>;
        manifest: DependencyManifest | undefined;
        requiresBuild: boolean;
      };
      error?: never;
    } {
  if (typeof integrity === 'string') {
    const match = integrity.match(INTEGRITY_REGEX);

    if (match === null) {
      return {
        status: 'error',
        error: { type: 'integrity_validation_failed', expected: integrity },
      };
    }

    const [, algo, integrityHash] = match;

    if (typeof integrityHash !== 'string') {
      return {
        status: 'error',
        error: { type: 'integrity_validation_failed', expected: integrity },
      };
    }

    if (typeof algo !== 'string') {
      return {
        status: 'error',
        error: { type: 'integrity_validation_failed', expected: integrity },
      };
    }

    // Compensate for the possibility of non-uniform Base64 padding
    const normalizedRemoteHash: string = Buffer.from(
      integrityHash,
      'base64'
    ).toString('hex');

    const calculatedHash: string = crypto.hash(algo, buffer, 'hex');

    if (calculatedHash !== normalizedRemoteHash) {
      return {
        status: 'error',
        error: {
          type: 'integrity_validation_failed',
          algorithm: algo,
          expected: integrity,
          found: `${algo}-${Buffer.from(calculatedHash, 'hex').toString('base64')}`,
        },
      };
    }
  }
  if (!cafsCache.has(storeDir)) {
    cafsCache.set(storeDir, createCafs(storeDir));
  }
  const cafs = cafsCache.get(storeDir);

  if (typeof cafs === 'undefined') {
    return {
      status: 'error',
      error: { type: 'cafs_not_found', storeDir },
    };
  }

  const { filesIndex, manifest } = cafs.addFilesFromTarball(buffer, true);

  const { filesIntegrity, filesMap } = processFilesIndex(filesIndex);

  const requiresBuild = writeFilesIndexFile(filesIndexFile, {
    manifest: manifest ?? {},
    files: filesIntegrity,
  });

  return {
    status: 'success',
    value: { filesIndex: filesMap, manifest, requiresBuild },
  };
}

type AddFilesFromDirResult = {
  status: string;
  value: {
    filesIndex: Record<string, string>;
    manifest?: DependencyManifest | undefined;
    requiresBuild: boolean;
  };
};

function initStore({ storeDir }: InitStoreMessage): { status: string } {
  fs.mkdirSync(storeDir, { recursive: true });
  try {
    const hexChars = '0123456789abcdef'.split('');

    for (const subDir of ['files', 'index']) {
      const subDirPath = path.join(storeDir, subDir);

      fs.mkdirSync(subDirPath);

      for (const hex1 of hexChars) {
        for (const hex2 of hexChars) {
          fs.mkdirSync(path.join(subDirPath, `${hex1}${hex2}`));
        }
      }
    }
  } catch {
    // If a parallel process has already started creating the directories in the store,
    // then we just stop.
  }

  return { status: 'success' };
}

async function addFilesFromDir({
  dir,
  storeDir,
  filesIndexFile,
  sideEffectsCacheKey,
  files,
}: AddDirToStoreMessage): Promise<AddFilesFromDirResult> {
  if (!cafsCache.has(storeDir)) {
    cafsCache.set(storeDir, createCafs(storeDir));
  }

  const cafs = cafsCache.get(storeDir);

  if (typeof cafs === 'undefined') {
    return {
      status: 'success',
      value: {
        filesIndex: {},
        manifest: {
          name: '',
          version: '',
        },
        requiresBuild: false,
      },
    };
  }

  const { filesIndex, manifest } = cafs.addFilesFromDir(dir, {
    files,
    readManifest: true,
  });

  const { filesIntegrity, filesMap } = processFilesIndex(filesIndex);

  let requiresBuild: boolean;

  if (typeof sideEffectsCacheKey === 'string') {
    let filesIndex!: PackageFilesIndex;

    try {
      filesIndex = await loadJsonFile<PackageFilesIndex>(filesIndexFile);
    } catch {
      // If there is no existing index file, then we cannot store the side effects.
      return {
        status: 'success',
        value: {
          filesIndex: filesMap,
          manifest,
          requiresBuild: pkgRequiresBuild(manifest, filesIntegrity),
        },
      };
    }
    filesIndex.sideEffects = filesIndex.sideEffects ?? {};
    filesIndex.sideEffects[sideEffectsCacheKey] = calculateDiff(
      filesIndex.files,
      filesIntegrity
    );
    if (filesIndex.requiresBuild == null) {
      requiresBuild = pkgRequiresBuild(manifest, filesIntegrity);
    } else {
      requiresBuild = filesIndex.requiresBuild;
    }
    writeJsonFile(filesIndexFile, filesIndex);
  } else {
    requiresBuild = writeFilesIndexFile(filesIndexFile, {
      manifest: manifest ?? {},
      files: filesIntegrity,
    });
  }
  return {
    status: 'success',
    value: { filesIndex: filesMap, manifest, requiresBuild },
  };
}

function calculateDiff(
  baseFiles: PackageFiles,
  sideEffectsFiles: PackageFiles
): SideEffectsDiff {
  const deleted: string[] = [];
  const added: PackageFiles = {};
  for (const file of new Set([
    ...Object.keys(baseFiles),
    ...Object.keys(sideEffectsFiles),
  ])) {
    if (!sideEffectsFiles[file]) {
      deleted.push(file);
    } else if (
      !baseFiles[file] ||
      baseFiles[file].integrity !== sideEffectsFiles[file].integrity ||
      baseFiles[file].mode !== sideEffectsFiles[file].mode
    ) {
      added[file] = sideEffectsFiles[file];
    }
  }
  const diff: SideEffectsDiff = {};
  if (deleted.length > 0) {
    diff.deleted = deleted;
  }
  if (Object.keys(added).length > 0) {
    diff.added = added;
  }
  return diff;
}

interface ProcessFilesIndexResult {
  filesIntegrity: PackageFiles;
  filesMap: Record<string, string>;
}

function processFilesIndex(filesIndex: FilesIndex): ProcessFilesIndexResult {
  const filesIntegrity: PackageFiles = {};
  const filesMap: Record<string, string> = {};
  for (const [
    k,
    { checkedAt, filePath, integrity, mode, size },
  ] of Object.entries(filesIndex)) {
    filesIntegrity[k] = {
      checkedAt,
      integrity: integrity.toString(), // TODO: use the raw Integrity object
      mode,
      size,
    };
    filesMap[k] = filePath;
  }
  return { filesIntegrity, filesMap };
}

interface ImportPackageResult {
  status: string;
  value: {
    isBuilt: boolean;
    importMethod?: string | undefined;
  };
}

function importPackage({
  storeDir,
  packageImportMethod,
  filesResponse,
  sideEffectsCacheKey,
  targetDir,
  requiresBuild,
  force,
  keepModulesDir,
  disableRelinkLocalDirDeps,
}: LinkPkgMessage): ImportPackageResult {
  const cacheKey = JSON.stringify({ storeDir, packageImportMethod });
  if (!cafsStoreCache.has(cacheKey)) {
    cafsStoreCache.set(
      cacheKey,
      createCafsStore(storeDir, { packageImportMethod, cafsLocker })
    );
  }
  const cafsStore = cafsStoreCache.get(cacheKey);

  if (typeof cafsStore === 'undefined') {
    return {
      status: 'success',
      value: { isBuilt: false, importMethod: '' },
    };
  }

  const { importMethod, isBuilt } = cafsStore.importPackage(targetDir, {
    filesResponse,
    force,
    disableRelinkLocalDirDeps,
    requiresBuild,
    sideEffectsCacheKey,
    keepModulesDir,
  });

  return { status: 'success', value: { isBuilt, importMethod } };
}

function symlinkAllModules(opts: SymlinkAllModulesMessage): {
  status: 'success';
} {
  for (const dep of opts.deps) {
    for (const [alias, pkgDir] of Object.entries(dep.children)) {
      if (alias !== dep.name) {
        symlinkDependencySync(pkgDir, dep.modules, alias);
      }
    }
  }
  return { status: 'success' };
}

function writeFilesIndexFile(
  filesIndexFile: string,
  {
    manifest,
    files,
    sideEffects,
  }: {
    manifest: Partial<DependencyManifest>;
    files: PackageFiles;
    sideEffects?: SideEffects;
  }
): boolean {
  const requiresBuild = pkgRequiresBuild(manifest, files);
  const filesIndex: PackageFilesIndex = {
    name: manifest.name,
    version: manifest.version,
    requiresBuild,
    files,
    sideEffects,
  };
  writeJsonFile(filesIndexFile, filesIndex);
  return requiresBuild;
}

function writeJsonFile(filePath: string, data: unknown): void {
  const targetDir = path.dirname(filePath);
  // TODO: use the API of @pnpm/cafs to write this file
  // There is actually no need to create the directory in 99% of cases.
  // So by using cafs API, we'll improve performance.
  fs.mkdirSync(targetDir, { recursive: true });
  // We remove the "-index.json" from the end of the temp file name
  // in order to avoid ENAMETOOLONG errors
  const temp = `${filePath.slice(0, -11)}${process.pid}`;
  gfs.writeFileSync(temp, JSON.stringify(data));
  optimisticRenameOverwrite(temp, filePath);
}

process.on('uncaughtException', (err) => {
  console.error(err);
});
