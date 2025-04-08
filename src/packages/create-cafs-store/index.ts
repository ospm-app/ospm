import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type CafsLocker,
  createCafs,
  getFilePathByModeInCafs,
} from '../store.cafs/index.ts';
import type {
  Cafs,
  PackageFilesResponse,
  PackageFiles,
  SideEffectsDiff,
  ImportPackageOpts,
  PackageFileInfo,
  ImportPackageFunction,
  ImportPackageFunctionAsync,
} from '../cafs-types/index.ts';
import { createIndexedPkgImporter } from '../fs.indexed-pkg-importer/index.ts';
import type {
  ImportIndexedPackage,
  ImportIndexedPackageAsync,
} from '../store-controller-types/index.ts';
import memoize from 'mem';
import pathTemp from 'path-temp';
import mapValues from 'ramda/src/map';

export type { CafsLocker };

export function createPackageImporterAsync(opts: {
  importIndexedPackage?: ImportIndexedPackageAsync | undefined;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  storeDir: string;
}): ImportPackageFunctionAsync<{
  importMethod?: string | undefined;
  isBuilt: boolean;
}> {
  const cachedImporterCreator = opts.importIndexedPackage
    ? (): ImportIndexedPackageAsync | undefined => {
        return opts.importIndexedPackage;
      }
    : memoize(createIndexedPkgImporter);

  const packageImportMethod = opts.packageImportMethod;

  const gfm = getFlatMap.bind(null, opts.storeDir);

  return async (
    to: string,
    opts: ImportPackageOpts
  ): Promise<{ importMethod?: string | undefined; isBuilt: boolean }> => {
    const { filesMap, isBuilt } = gfm(
      opts.filesResponse,
      opts.sideEffectsCacheKey
    );

    const willBeBuilt = !isBuilt && opts.requiresBuild;

    const pkgImportMethod =
      willBeBuilt === true
        ? 'clone-or-copy'
        : (opts.filesResponse.packageImportMethod ?? packageImportMethod);

    const impPkg = cachedImporterCreator(pkgImportMethod);

    const importMethod = await impPkg?.(to, {
      disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
      filesMap,
      resolvedFrom: opts.filesResponse.resolvedFrom,
      force: opts.force,
      keepModulesDir: Boolean(opts.keepModulesDir),
    });

    return { importMethod, isBuilt };
  };
}

function createPackageImporter(opts: {
  importIndexedPackage?: ImportIndexedPackage | undefined;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  storeDir: string;
}): ImportPackageFunction<{
  isBuilt: boolean;
  importMethod?: string | undefined;
}> {
  const cachedImporterCreator = opts.importIndexedPackage
    ? () => opts.importIndexedPackage
    : memoize(createIndexedPkgImporter);

  const packageImportMethod = opts.packageImportMethod;

  const gfm = getFlatMap.bind(null, opts.storeDir);

  return (
    to: string,
    opts: ImportPackageOpts
  ): {
    isBuilt: boolean;
    importMethod?: string | undefined;
  } => {
    const { filesMap, isBuilt } = gfm(
      opts.filesResponse,
      opts.sideEffectsCacheKey
    );

    const willBeBuilt = !isBuilt && opts.requiresBuild;

    const pkgImportMethod =
      willBeBuilt === true
        ? 'clone-or-copy'
        : (opts.filesResponse.packageImportMethod ?? packageImportMethod);

    const impPkg = cachedImporterCreator(pkgImportMethod);

    const importMethod = impPkg?.(to, {
      disableRelinkLocalDirDeps: opts.disableRelinkLocalDirDeps,
      filesMap,
      resolvedFrom: opts.filesResponse.resolvedFrom,
      force: opts.force,
      keepModulesDir: Boolean(opts.keepModulesDir),
    });

    return { importMethod, isBuilt };
  };
}

function getFlatMap(
  storeDir: string,
  filesResponse: PackageFilesResponse,
  targetEngine?: string | undefined
): { filesMap: Record<string, string>; isBuilt: boolean } {
  let isBuilt: boolean | undefined;

  let filesIndex!: PackageFiles;

  if (
    typeof targetEngine === 'string' &&
    filesResponse.sideEffects?.[targetEngine] != null
  ) {
    filesIndex = applySideEffectsDiff(
      filesResponse.filesIndex,
      filesResponse.sideEffects[targetEngine]
    );

    isBuilt = true;
  } else if (filesResponse.unprocessed === true) {
    filesIndex = filesResponse.filesIndex as PackageFiles;

    isBuilt = false;
  } else {
    return {
      filesMap: filesResponse.filesIndex as Record<string, string>,
      isBuilt: false,
    };
  }

  const filesMap = mapValues.default(
    ({ integrity, mode }: PackageFileInfo): string => {
      return getFilePathByModeInCafs(storeDir, integrity, mode);
    },
    filesIndex
  );

  return { filesMap, isBuilt };
}

function applySideEffectsDiff(
  baseFiles: PackageFiles | Record<string, string>,
  { added, deleted }: SideEffectsDiff
): PackageFiles {
  const filesWithSideEffects: PackageFiles = { ...added };

  for (const fileName in baseFiles) {
    if (
      deleted?.includes(fileName) !== true &&
      !filesWithSideEffects[fileName]
    ) {
      const f = baseFiles[fileName];

      if (typeof f !== 'string' && typeof f !== 'undefined') {
        filesWithSideEffects[fileName] = f;
      }
    }
  }

  return filesWithSideEffects;
}

export function createCafsStore(
  storeDir: string,
  opts?:
    | {
        ignoreFile?: ((filename: string) => boolean) | undefined;
        importPackage?: ImportIndexedPackage | undefined;
        packageImportMethod?:
          | 'auto'
          | 'hardlink'
          | 'copy'
          | 'clone'
          | 'clone-or-copy'
          | undefined;
        cafsLocker?: CafsLocker | undefined;
      }
    | undefined
): Cafs {
  const baseTempDir = path.join(storeDir, 'tmp');

  return {
    ...createCafs(storeDir, opts),
    storeDir,
    importPackage: createPackageImporter({
      importIndexedPackage: opts?.importPackage,
      packageImportMethod: opts?.packageImportMethod,
      storeDir,
    }),
    tempDir: async () => {
      const tmpDir = pathTemp(baseTempDir);
      await fs.mkdir(tmpDir, { recursive: true });
      return tmpDir;
    },
  };
}
