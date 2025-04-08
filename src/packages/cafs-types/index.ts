import type { IntegrityLike } from 'ssri';
import type { DependencyManifest } from '../types/index.ts';
// import type { FetchResponse } from '../store-controller-types/index.ts';

export type PackageFiles = Record<string, PackageFileInfo>;

export type PackageFileInfo = {
  checkedAt?: number | undefined; // Nullable for backward compatibility
  integrity: string;
  mode: number;
  size: number;
};

export type SideEffects = Record<string, SideEffectsDiff>;

export type SideEffectsDiff = {
  deleted?: string[] | undefined;
  added?: PackageFiles | undefined;
};

export type ResolvedFrom = 'store' | 'local-dir' | 'remote';

export type PackageFilesResponse = {
  resolvedFrom: ResolvedFrom;
  packageImportMethod?:
    | 'auto'
    | 'hardlink'
    | 'copy'
    | 'clone'
    | 'clone-or-copy'
    | undefined;
  sideEffects?: SideEffects | undefined;
  requiresBuild: boolean;
  unprocessed: boolean;
} & (
  | {
      filesIndex: PackageFiles;
    }
  | {
      filesIndex: Record<string, string>;
    }
);

export type ImportPackageOpts = {
  disableRelinkLocalDirDeps?: boolean | undefined;
  requiresBuild?: boolean | undefined;
  sideEffectsCacheKey?: string | undefined;
  filesResponse: PackageFilesResponse;
  force: boolean;
  keepModulesDir?: boolean | undefined;
};

export type ImportPackageFunction<IP> = (
  to: string,
  opts: ImportPackageOpts
) => IP;

export type ImportPackageFunctionAsync<IP> = (
  to: string,
  opts: ImportPackageOpts
) => Promise<IP>;

export type FileType = 'exec' | 'nonexec' | 'index';

export type FilesIndex = {
  [filename: string]: {
    mode: number;
    size: number;
  } & FileWriteResult;
};

export type FileWriteResult = {
  checkedAt: number;
  filePath: string;
  integrity: IntegrityLike;
};

export type AddToStoreResult = {
  filesIndex: FilesIndex;
  manifest?: DependencyManifest | undefined;
};

export type Cafs = {
  storeDir: string;
  addFilesFromDir: (dir: string) => AddToStoreResult;
  addFilesFromTarball: (buffer: Buffer) => AddToStoreResult;
  getIndexFilePathInCafs: (
    integrity: string | IntegrityLike,
    fileType: FileType
  ) => string;
  getFilePathByModeInCafs: (
    integrity: string | IntegrityLike,
    mode: number
  ) => string;
  importPackage: ImportPackageFunction<{
    isBuilt: boolean;
    importMethod?: string | undefined;
  }>;
  tempDir: () => Promise<string>;
};
