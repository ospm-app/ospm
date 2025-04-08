import path from 'node:path';
import fs from 'node:fs';
import {
  createCafsStore,
  type CafsLocker,
  createPackageImporterAsync,
} from '../../create-cafs-store/index.ts';
import type { ResolveFunction } from '../../resolver-base/index.ts';
import type {
  PackageResponse,
  StoreController,
  ImportIndexedPackageAsync,
  NewStoreController,
} from '../../store-controller-types/index.ts';
import {
  addFilesFromDir,
  importPackage,
  initStoreDir,
} from '../../worker/index.ts';
import { prune } from './prune.ts';
import type { StoreServerController } from 'src/packages/server/connectStoreController.ts';
import {
  createPackageRequester,
  createServerPackageRequester,
  createNewStorePackageRequester,
} from 'src/packages/package-requester/packageRequester.ts';
import type { TarballFetchers } from 'src/packages/tarball-fetcher/index.ts';
import type { ImportPackageOpts } from 'src/packages/cafs-types/index.ts';
export type { CafsLocker };

export function createPackageStore(
  resolve: ResolveFunction,
  fetchers: TarballFetchers,
  initOpts: {
    cafsLocker?: CafsLocker | undefined;
    engineStrict?: boolean | undefined;
    force?: boolean | undefined;
    nodeVersion?: string | undefined;
    importPackage?: ImportIndexedPackageAsync | undefined;
    pnpmVersion?: string | undefined;
    ignoreFile?: ((filename: string) => boolean) | undefined;
    cacheDir: string;
    storeDir: string;
    networkConcurrency?: number | undefined;
    packageImportMethod?:
      | 'auto'
      | 'hardlink'
      | 'copy'
      | 'clone'
      | 'clone-or-copy'
      | undefined;
    verifyStoreIntegrity?: boolean | undefined;
    virtualStoreDirMaxLength: number;
    strictStorePkgContentCheck?: boolean | undefined;
    clearResolutionCache: () => void;
  }
): StoreController<
  PackageResponse,
  PackageResponse,
  { importMethod?: string | undefined; isBuilt: boolean }
> {
  const storeDir = initOpts.storeDir;

  if (!fs.existsSync(path.join(storeDir, 'files'))) {
    initStoreDir(storeDir).catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(error.message);
      } else if (typeof error === 'string') {
        console.error(error);
      } else {
        console.error(JSON.stringify(error));
      }
    });
  }

  const cafs = createCafsStore(storeDir, {
    cafsLocker: initOpts.cafsLocker,
    packageImportMethod: initOpts.packageImportMethod,
  });

  const packageRequester = createPackageRequester({
    force: initOpts.force,
    engineStrict: initOpts.engineStrict,
    nodeVersion: initOpts.nodeVersion,
    pnpmVersion: initOpts.pnpmVersion,
    resolve,
    fetchers,
    cafs,
    ignoreFile: initOpts.ignoreFile,
    networkConcurrency: initOpts.networkConcurrency,
    storeDir: initOpts.storeDir,
    verifyStoreIntegrity: initOpts.verifyStoreIntegrity,
    virtualStoreDirMaxLength: initOpts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: initOpts.strictStorePkgContentCheck,
  });

  return {
    close: async () => {}, // eslint-disable-line:no-empty
    fetchPackage: packageRequester.fetchPackageToStore,
    getFilesIndexFilePath: packageRequester.getFilesIndexFilePath,
    importPackage:
      typeof initOpts.importPackage === 'undefined'
        ? (
            targetDir,
            opts
          ): Promise<{
            isBuilt: boolean;
            importMethod?: string | undefined;
          }> => {
            return importPackage<{
              isBuilt: boolean;
              importMethod?: string | undefined;
            }>({
              ...opts,
              packageImportMethod: initOpts.packageImportMethod,
              storeDir: initOpts.storeDir,
              targetDir,
            });
          }
        : createPackageImporterAsync({
            importIndexedPackage: initOpts.importPackage,
            storeDir: cafs.storeDir,
          }),
    prune: prune.bind(null, { storeDir, cacheDir: initOpts.cacheDir }),
    requestPackage: packageRequester.requestPackage,
    upload,
    clearResolutionCache: initOpts.clearResolutionCache,
  };

  async function upload(
    builtPkgLocation: string,
    opts: { filesIndexFile: string; sideEffectsCacheKey: string }
  ): Promise<void> {
    await addFilesFromDir({
      storeDir: cafs.storeDir,
      dir: builtPkgLocation,
      sideEffectsCacheKey: opts.sideEffectsCacheKey,
      filesIndexFile: opts.filesIndexFile,
      pkg: {},
    });
  }
}

export function createNewPackageStore(
  resolve: ResolveFunction,
  fetchers: TarballFetchers,
  initOpts: {
    cafsLocker?: CafsLocker | undefined;
    engineStrict?: boolean | undefined;
    force?: boolean | undefined;
    nodeVersion?: string | undefined;
    importPackage?: ImportIndexedPackageAsync | undefined;
    pnpmVersion?: string | undefined;
    ignoreFile?: ((filename: string) => boolean) | undefined;
    cacheDir: string;
    storeDir: string;
    networkConcurrency?: number | undefined;
    packageImportMethod?:
      | 'auto'
      | 'hardlink'
      | 'copy'
      | 'clone'
      | 'clone-or-copy'
      | undefined;
    verifyStoreIntegrity?: boolean | undefined;
    virtualStoreDirMaxLength: number;
    strictStorePkgContentCheck?: boolean | undefined;
    clearResolutionCache: () => void;
  }
): NewStoreController<
  PackageResponse,
  PackageResponse,
  { isBuilt: boolean; importMethod?: string | undefined }
> {
  const storeDir = initOpts.storeDir;

  if (!fs.existsSync(path.join(storeDir, 'files'))) {
    initStoreDir(storeDir).catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(error.message);
      } else if (typeof error === 'string') {
        console.error(error);
      } else {
        console.error(JSON.stringify(error));
      }
    });
  }

  const cafs = createCafsStore(storeDir, {
    cafsLocker: initOpts.cafsLocker,
    packageImportMethod: initOpts.packageImportMethod,
  });

  const packageRequester = createNewStorePackageRequester({
    force: initOpts.force,
    engineStrict: initOpts.engineStrict,
    nodeVersion: initOpts.nodeVersion,
    pnpmVersion: initOpts.pnpmVersion,
    resolve,
    fetchers,
    cafs,
    ignoreFile: initOpts.ignoreFile,
    networkConcurrency: initOpts.networkConcurrency,
    storeDir: initOpts.storeDir,
    verifyStoreIntegrity: initOpts.verifyStoreIntegrity,
    virtualStoreDirMaxLength: initOpts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: initOpts.strictStorePkgContentCheck,
  });

  return {
    close: async () => {}, // eslint-disable-line:no-empty
    fetchPackage: packageRequester.fetchPackageToStore,
    getFilesIndexFilePath: packageRequester.getFilesIndexFilePath,
    importPackage:
      typeof initOpts.importPackage === 'undefined'
        ? (
            targetDir,
            opts
          ): Promise<{
            isBuilt: boolean;
            importMethod?: string | undefined;
          }> => {
            return importPackage<{
              isBuilt: boolean;
              importMethod?: string | undefined;
            }>({
              ...opts,
              packageImportMethod: initOpts.packageImportMethod,
              storeDir: initOpts.storeDir,
              targetDir,
            });
          }
        : createPackageImporterAsync({
            importIndexedPackage: initOpts.importPackage,
            storeDir: cafs.storeDir,
          }),
    prune: prune.bind(null, { storeDir, cacheDir: initOpts.cacheDir }),
    requestPackage: packageRequester.requestPackage,
    upload,
    clearResolutionCache: initOpts.clearResolutionCache,
  };

  async function upload(
    builtPkgLocation: string,
    opts: { filesIndexFile: string; sideEffectsCacheKey: string }
  ): Promise<void> {
    await addFilesFromDir({
      storeDir: cafs.storeDir,
      dir: builtPkgLocation,
      sideEffectsCacheKey: opts.sideEffectsCacheKey,
      filesIndexFile: opts.filesIndexFile,
      pkg: {},
    });
  }
}

export function createServerPackageStore(
  resolve: ResolveFunction,
  fetchers: TarballFetchers,
  initOpts: {
    cafsLocker?: CafsLocker | undefined;
    engineStrict?: boolean | undefined;
    force?: boolean | undefined;
    nodeVersion?: string | undefined;
    importPackage?: ImportIndexedPackageAsync | undefined;
    pnpmVersion?: string | undefined;
    ignoreFile?: ((filename: string) => boolean) | undefined;
    cacheDir: string;
    storeDir: string;
    networkConcurrency?: number | undefined;
    packageImportMethod?:
      | 'auto'
      | 'hardlink'
      | 'copy'
      | 'clone'
      | 'clone-or-copy'
      | undefined;
    verifyStoreIntegrity?: boolean | undefined;
    virtualStoreDirMaxLength: number;
    strictStorePkgContentCheck?: boolean | undefined;
    clearResolutionCache: () => void;
  }
): StoreServerController<
  PackageResponse,
  PackageResponse,
  {
    isBuilt: boolean;
    importMethod?: string | undefined;
  }
> {
  const storeDir = initOpts.storeDir;

  if (!fs.existsSync(path.join(storeDir, 'files'))) {
    initStoreDir(storeDir).catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(error.message);
      } else if (typeof error === 'string') {
        console.error(error);
      } else {
        console.error(JSON.stringify(error));
      }
    });
  }

  const cafs = createCafsStore(storeDir, {
    cafsLocker: initOpts.cafsLocker,
    packageImportMethod: initOpts.packageImportMethod,
  });

  const packageRequester = createServerPackageRequester({
    force: initOpts.force,
    engineStrict: initOpts.engineStrict,
    nodeVersion: initOpts.nodeVersion,
    pnpmVersion: initOpts.pnpmVersion,
    resolve,
    fetchers,
    cafs,
    ignoreFile: initOpts.ignoreFile,
    networkConcurrency: initOpts.networkConcurrency,
    storeDir: initOpts.storeDir,
    verifyStoreIntegrity: initOpts.verifyStoreIntegrity,
    virtualStoreDirMaxLength: initOpts.virtualStoreDirMaxLength,
    strictStorePkgContentCheck: initOpts.strictStorePkgContentCheck,
  });

  return {
    stop: async () => {},
    close: async () => {},
    fetchPackage: packageRequester.fetchPackageToStore,
    getFilesIndexFilePath: packageRequester.getFilesIndexFilePath,
    importPackage:
      typeof initOpts.importPackage === 'undefined'
        ? (
            targetDir: string,
            opts: ImportPackageOpts
          ): Promise<{
            isBuilt: boolean;
            importMethod?: string | undefined;
          }> => {
            return importPackage<{
              isBuilt: boolean;
              importMethod?: string | undefined;
            }>({
              ...opts,
              packageImportMethod: initOpts.packageImportMethod,
              storeDir: initOpts.storeDir,
              targetDir,
            });
          }
        : createPackageImporterAsync({
            importIndexedPackage: initOpts.importPackage,
            storeDir: cafs.storeDir,
          }),
    prune: prune.bind(null, { storeDir, cacheDir: initOpts.cacheDir }),
    requestPackage: packageRequester.requestPackage,
    upload,
    clearResolutionCache: initOpts.clearResolutionCache,
  };

  async function upload(
    builtPkgLocation: string,
    opts: { filesIndexFile: string; sideEffectsCacheKey: string }
  ): Promise<void> {
    await addFilesFromDir({
      storeDir: cafs.storeDir,
      dir: builtPkgLocation,
      sideEffectsCacheKey: opts.sideEffectsCacheKey,
      filesIndexFile: opts.filesIndexFile,
      pkg: {},
    });
  }
}
