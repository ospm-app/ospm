import type {
  DirectoryResolution,
  PreferredVersions,
  Resolution,
  WorkspacePackages,
} from '../resolver-base/index.ts';
import type {
  ImportPackageFunctionAsync,
  PackageFilesResponse,
  ResolvedFrom,
} from '../cafs-types/index.ts';
import type {
  SupportedArchitectures,
  DependencyManifest,
  PackageManifest,
  PkgResolutionId,
  LockFileDir,
  GlobalPkgDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import type { WantedDependency } from '../resolve-dependencies/index.ts';

export type BundledManifest = Pick<
  DependencyManifest,
  | 'bin'
  | 'bundledDependencies'
  | 'bundleDependencies'
  | 'dependencies'
  | 'directories'
  | 'engines'
  | 'name'
  | 'optionalDependencies'
  | 'os'
  | 'peerDependencies'
  | 'peerDependenciesMeta'
  | 'scripts'
  | 'version'
>;

export type UploadPkgToStoreOpts = {
  filesIndexFile: string;
  sideEffectsCacheKey: string;
};

export type UploadPkgToStore = (
  builtPkgLocation: string,
  opts: UploadPkgToStoreOpts
) => Promise<void>;

export type StoreController<RP, FP, IP> = {
  requestPackage: RequestPackageFunction<RP>;
  fetchPackage:
    | FetchPackageToStoreFunction<FP>
    | FetchPackageToStoreFunctionAsync<FP>;
  getFilesIndexFilePath: GetFilesIndexFilePath;
  importPackage: ImportPackageFunctionAsync<IP>;
  close: () => Promise<void>;
  prune: (removeAlienFiles?: boolean | undefined) => Promise<void>;
  upload: UploadPkgToStore;
  clearResolutionCache: () => void;
};

export type NewStoreController<RP, FP, IP> = {
  requestPackage: RequestPackageFunction<RP>;
  fetchPackage:
    | FetchPackageToStoreFunction<FP>
    | FetchPackageToStoreFunctionAsync<FP>;
  getFilesIndexFilePath: GetFilesIndexFilePath;
  importPackage: ImportPackageFunctionAsync<IP>;
  close: () => Promise<void>;
  prune: (removeAlienFiles?: boolean | undefined) => Promise<void>;
  upload: UploadPkgToStore;
  clearResolutionCache: () => void;
};

export type PkgRequestFetchResult<R> = {
  bundledManifest?: BundledManifest | undefined;
  files: PackageFilesResponse;
  fetching?: (() => Promise<R>) | undefined;
};

export type FetchResponse<R> = {
  filesIndexFile?: string | undefined;
  fetching: () => Promise<R>;
  inStoreLocation?: string | undefined;
};

export type FetchStoreResponse<FS> = {
  filesIndexFile?: string | undefined;
  fetching: () => Promise<FS>;
  inStoreLocation?: string | undefined;
};

export type FetchPackageToStoreFunction<FP> = (
  opts: FetchPackageToStoreOptions
) => Promise<FP>;

export type FetchPackageToStoreFunctionAsync<FP> = (
  opts: FetchPackageToStoreOptions
) => FP;

export type GetFilesIndexFilePath = (
  opts: Pick<FetchPackageToStoreOptions, 'pkg' | 'ignoreScripts'>
) => {
  filesIndexFile: string;
  target: string;
};

export interface PkgNameVersion {
  name?: string | undefined;
  version?: string | undefined;
}

export type FetchPackageToStoreOptions = {
  fetchRawManifest?: boolean | undefined;
  force: boolean;
  ignoreScripts?: boolean | undefined;
  lockfileDir: string;
  pkg: PkgNameVersion & {
    id: string;
    resolution: Resolution | undefined;
  };
  /**
   * Expected package is the package name and version that are found in the lockfile.
   */
  expectedPkg?: PkgNameVersion | undefined;
  onFetchError?: OnFetchError | undefined;
};

export type RequestPackageToStoreOptions = {
  fetchRawManifest?: boolean | undefined;
  force: boolean;
  ignoreScripts?: boolean | undefined;
  lockfileDir: string;
  pkg: PkgNameVersion & {
    id: string;
    resolution: Resolution | undefined;
  };
  /**
   * Expected package is the package name and version that are found in the lockfile.
   */
  expectedPkg?: PkgNameVersion | undefined;
  onFetchError?: OnFetchError | undefined;
};

export type OnFetchError = (error: Error) => Error;

export type RequestPackageFunction<R> = (
  wantedDependency: WantedDependency & { optional?: boolean | undefined },
  options: RequestPackageOptions
) => Promise<R>;

export type RequestPackageOptions = {
  alwaysTryWorkspacePackages?: boolean | undefined;
  currentPkg?:
    | {
        id?: PkgResolutionId | undefined;
        resolution?: Resolution | undefined;
      }
    | undefined;
  /**
   * Expected package is the package name and version that are found in the lockfile.
   */
  expectedPkg?: PkgNameVersion | undefined;
  defaultTag?: string | undefined;
  pickLowestVersion?: boolean | undefined;
  publishedBy?: Date | undefined;
  downloadPriority: number;
  ignoreScripts?: boolean | undefined;
  projectDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  lockfileDir: LockFileDir;
  preferredVersions: PreferredVersions;
  preferWorkspacePackages?: boolean | undefined;
  registry: string;
  sideEffectsCache?: boolean | undefined;
  skipFetch?: boolean | undefined;
  update?: false | 'compatible' | 'latest' | undefined;
  workspacePackages?: WorkspacePackages | undefined;
  forceResolve?: boolean | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
  onFetchError?: OnFetchError | undefined;
  injectWorkspacePackages?: boolean | undefined;
};

export type BundledManifestFunction = () => Promise<
  BundledManifest | undefined
>;

// PkgRequestFetchResult

// {
//   files: {
//     unprocessed: boolean;
//     resolvedFrom: 'store' | 'local-dir' | 'remote';
//     filesIndex: PackageFiles;
//     packageImportMethod?:
//       | 'auto'
//       | 'hardlink'
//       | 'copy'
//       | 'clone'
//       | 'clone-or-copy'
//       | undefined;
//     requiresBuild: boolean;
//     sideEffects?: SideEffects | undefined;
//   };
//   bundledManifest: BundledManifest | undefined;
// }

export type PackageResponse = {
  fetching?:
    | (() => Promise<PkgRequestFetchResult<PackageResponse>>)
    | undefined;
  filesIndexFile?: string | undefined;
  body?:
    | ({
        isLocal: boolean;
        isInstallable?: boolean | undefined;
        resolution?: Resolution | undefined;
        manifest?: PackageManifest | undefined;
        id: PkgResolutionId;
        normalizedPref?: string | undefined;
        updated: boolean;
        publishedAt?: string | undefined;
        resolvedVia?: string | undefined;
        // This is useful for recommending updates.
        // If latest does not equal the version of the
        // resolved package, it is out-of-date.
        latest?: string | undefined;
      } & (
        | {
            isLocal: true;
            resolution: DirectoryResolution;
          }
        | {
            isLocal: false;
          }
      ))
    | undefined;
};

export type PackageStoreManagerResponse<R> = {
  fetching?: (() => Promise<R>) | undefined;
  filesIndexFile?: string | undefined;
  body?:
    | ({
        isLocal: boolean;
        isInstallable?: boolean | undefined;
        resolution?: Resolution | undefined;
        manifest?: PackageManifest | undefined;
        id: PkgResolutionId;
        normalizedPref?: string | undefined;
        updated: boolean;
        publishedAt?: string | undefined;
        resolvedVia?: string | undefined;
        // This is useful for recommending updates.
        // If latest does not equal the version of the
        // resolved package, it is out-of-date.
        latest?: string | undefined;
      } & (
        | {
            isLocal: true;
            resolution: DirectoryResolution;
          }
        | {
            isLocal: false;
          }
      ))
    | undefined;
};

export type FilesMap = Record<string, string>;

export interface ImportOptions {
  disableRelinkLocalDirDeps?: boolean | undefined;
  filesMap: FilesMap;
  force: boolean;
  resolvedFrom: ResolvedFrom;
  keepModulesDir?: boolean | undefined;
}

export type ImportIndexedPackage = (
  to: string,
  opts: ImportOptions
) => string | undefined;

export type ImportIndexedPackageAsync = (
  to: string,
  opts: ImportOptions
) => Promise<string | undefined>;
