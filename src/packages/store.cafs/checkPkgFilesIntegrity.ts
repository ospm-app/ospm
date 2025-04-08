import fs from 'node:fs';
import util from 'node:util';
import type {
  PackageFiles,
  PackageFileInfo,
  SideEffects,
} from '../cafs-types/index.ts';
import gfs from '../graceful-fs/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import rimraf from '@zkochan/rimraf';
import ssri from 'ssri';
import { getFilePathByModeInCafs } from './getFilePathInCafs.ts';
import { parseJsonBufferSync } from './parseJson.ts';

// We track how many files were checked during installation.
// It should be rare that a files content should be checked.
// If it happens too frequently, something is wrong.
// Checking a file's integrity is an expensive operation!
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
global['verifiedFileIntegrity'] = 0;

export type VerifyResult = {
  passed: boolean;
  manifest?: DependencyManifest | undefined;
};

export type PackageFilesIndex = {
  // name and version are nullable for backward compatibility
  // the initial specs of pnpm store v3 did not require these fields.
  // However, it might be possible that some types of dependencies don't
  // have the name/version fields, like the local tarball dependencies.
  name?: string | undefined;
  version?: string | undefined;
  requiresBuild?: boolean | undefined;

  files: PackageFiles;
  sideEffects?: SideEffects | undefined;
};

export function checkPkgFilesIntegrity(
  storeDir: string,
  pkgIndex: PackageFilesIndex,
  readManifest?: boolean | undefined
): VerifyResult {
  // It might make sense to use this cache for all files in the store
  // but there's a smaller chance that the same file will be checked twice
  // so it's probably not worth the memory (this assumption should be verified)
  const verifiedFilesCache = new Set<string>();

  const _checkFilesIntegrity = checkFilesIntegrity.bind(
    null,
    verifiedFilesCache,
    storeDir
  );

  const verified = _checkFilesIntegrity(pkgIndex.files, readManifest);

  if (!verified.passed) {
    return { passed: false };
  }

  if (pkgIndex.sideEffects) {
    // We verify all side effects cache. We could optimize it to verify only the side effects cache
    // that satisfies the current os/arch/platform.
    // However, it likely won't make a big difference.
    for (const [sideEffectName, { added }] of Object.entries(
      pkgIndex.sideEffects
    )) {
      if (added) {
        const { passed } = _checkFilesIntegrity(added);

        if (!passed) {
          delete pkgIndex.sideEffects[sideEffectName];
        }
      }
    }
  }

  return verified;
}

function checkFilesIntegrity(
  verifiedFilesCache: Set<string>,
  storeDir: string,
  files: PackageFiles,
  readManifest?: boolean | undefined
): VerifyResult {
  let allVerified = true;

  let manifest: DependencyManifest | undefined;

  for (const [f, fstat] of Object.entries(files)) {
    if (!fstat.integrity) {
      throw new Error(`Integrity checksum is missing for ${f}`);
    }

    const filename = getFilePathByModeInCafs(
      storeDir,
      fstat.integrity,
      fstat.mode
    );

    const readFile = readManifest === true && f === 'package.json';

    if (!readFile && verifiedFilesCache.has(filename)) {
      continue;
    }

    const verifyResult = verifyFile(filename, fstat, readFile);

    if (readFile) {
      manifest = verifyResult.manifest;
    }

    if (verifyResult.passed) {
      verifiedFilesCache.add(filename);
    } else {
      allVerified = false;
    }
  }

  return {
    passed: allVerified,
    manifest,
  };
}

type FileInfo = Pick<PackageFileInfo, 'size' | 'checkedAt'> & {
  integrity: string | ssri.IntegrityLike;
};

function verifyFile(
  filename: string,
  fstat: FileInfo,
  readManifest?: boolean | undefined
): VerifyResult {
  const currentFile = checkFile(filename, fstat.checkedAt);

  if (currentFile == null) return { passed: false };

  if (currentFile.isModified) {
    if (currentFile.size !== fstat.size) {
      rimraf.sync(filename);

      return { passed: false };
    }

    return verifyFileIntegrity(filename, fstat, readManifest);
  }

  if (readManifest === true) {
    return {
      passed: true,
      manifest: parseJsonBufferSync(
        gfs.readFileSync(filename)
      ) as DependencyManifest,
    };
  }
  // If a file was not edited, we are skipping integrity check.
  // We assume that nobody will manually remove a file in the store and create a new one.
  return { passed: true };
}

export function verifyFileIntegrity(
  filename: string,
  expectedFile: FileInfo,
  readManifest?: boolean
): VerifyResult {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global['verifiedFileIntegrity']++;

  try {
    const data = gfs.readFileSync(filename);

    const passed = Boolean(ssri.checkData(data, expectedFile.integrity));

    if (!passed) {
      gfs.unlinkSync(filename);
      return { passed };
    }

    if (readManifest === true) {
      return {
        passed,
        manifest: parseJsonBufferSync(data) as DependencyManifest,
      };
    }

    return { passed };
  } catch (err: unknown) {
    switch (util.types.isNativeError(err) && 'code' in err && err.code) {
      case 'ENOENT': {
        return { passed: false };
      }

      case 'EINTEGRITY': {
        // Broken files are removed from the store
        gfs.unlinkSync(filename);
        return { passed: false };
      }
    }

    throw err;
  }
}

function checkFile(
  filename: string,
  checkedAt?: number | undefined
): { isModified: boolean; size: number } | null {
  try {
    const { mtimeMs, size } = fs.statSync(filename);

    return {
      isModified: mtimeMs - (checkedAt ?? 0) > 100,
      size,
    };
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return null;
    }

    throw err;
  }
}
