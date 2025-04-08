import type { PackageFilesResponse } from '../cafs-types/index.ts';

export type PkgNameVersion = {
  name?: string | undefined;
  version?: string | undefined;
};

export type InitStoreMessage = {
  type: 'init-store';
  storeDir: string;
};

export type TarballExtractMessage = {
  type: 'extract';
  buffer: Buffer;
  storeDir: string;
  integrity?: string | undefined;
  filesIndexFile: string;
  readManifest?: boolean | undefined;
  pkg?: PkgNameVersion | undefined;
};

export type LinkPkgMessage = {
  type: 'link';
  storeDir: string;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  filesResponse: PackageFilesResponse;
  sideEffectsCacheKey?: string | undefined;
  targetDir: string;
  requiresBuild?: boolean | undefined;
  force: boolean;
  keepModulesDir?: boolean | undefined;
  disableRelinkLocalDirDeps?: boolean | undefined;
};

export type SymlinkAllModulesMessage = {
  type: 'symlinkAllModules';
  deps: Array<{
    children: Record<string, string>;
    modules: string;
    name: string;
  }>;
};

export type AddDirToStoreMessage = {
  type: 'add-dir';
  storeDir: string;
  dir: string;
  filesIndexFile: string;
  sideEffectsCacheKey?: string | undefined;
  readManifest?: boolean | undefined;
  pkg?: PkgNameVersion | undefined;
  files?: string[] | undefined;
};

export type ReadPkgFromCafsMessage = {
  type: 'readPkgFromCafs';
  storeDir: string;
  filesIndexFile: string;
  readManifest: boolean;
  verifyStoreIntegrity: boolean;
};

export type HardLinkDirMessage = {
  type: 'hardLinkDir';
  src: string;
  destDirs: string[];
};
