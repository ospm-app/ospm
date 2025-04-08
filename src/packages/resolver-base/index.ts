import type { WantedDependency } from '../resolve-dependencies/index.ts';
import type {
  ProjectRootDir,
  PkgResolutionId,
  DependencyManifest,
  GlobalPkgDir,
  ProjectRootDirRealPath,
  LockFileDir,
  WorkspaceDir,
} from '../types/index.ts';

export type TarballResolution = {
  // type?: never;
  // directory?: never;
  // commit?: never;
  // repo?: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  path: string;
};

export type DirectoryResolution = {
  type: 'directory';
  directory: string;
  // commit?: never;
  // repo?: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  // path?: never;
};

export type GitResolution = {
  type: 'git';
  // directory: never;
  commit: string;
  repo: string;
  tarball?: string | undefined;
  integrity?: string | undefined;
  path: string;
};

export type LocalTarballResolution = {
  type: 'localTarball';
  // directory: never;
  // commit: never;
  // repo: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  // path: never;
};

export type GitHostedTarballResolution = {
  type: 'gitHostedTarball';
  // directory: never;
  // commit: never;
  // repo: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  // path: never;
};

export type RemoteTarballResolution = {
  type: 'remoteTarball';
  // directory: never;
  // commit: never;
  // repo: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  // path: never;
};

export type GenericTarballResolution = {
  // type?: never;
  // directory?: string | undefined;
  // commit?: never;
  // repo?: never;
  tarball?: string | undefined;
  integrity?: string | undefined;
  // path?: never;
};

export type Resolution =
  | TarballResolution
  | DirectoryResolution
  | GitResolution
  | LocalTarballResolution
  | GitHostedTarballResolution
  | RemoteTarballResolution
  | GenericTarballResolution;

/**
 * A dependency on a workspace package.
 */
export type WorkspaceResolveResult = {
  id: PkgResolutionId;
  latest?: string | undefined;
  publishedAt?: string | undefined;
  manifest?: DependencyManifest | undefined;
  normalizedPref?: string | undefined; // is null for npm-hosted dependencies
  resolution: Resolution;
  /**
   * 'workspace' will be returned for workspace: protocol dependencies or a
   * package in the workspace that matches the wanted dependency's name and
   * version range.
   */
  resolvedVia: 'workspace';
};

export type ResolveResult = {
  id: PkgResolutionId;
  latest?: string | undefined;
  publishedAt?: string | undefined;
  manifest?: DependencyManifest | undefined;
  normalizedPref?: string | undefined; // is null for npm-hosted dependencies
  resolution: Resolution;
  resolvedVia: 'npm-registry' | 'git-repository' | 'local-filesystem' | 'url'; // | string;
};

export type WorkspacePackage = {
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  manifest: DependencyManifest;
};

export type WorkspacePackagesByVersion = Map<string, WorkspacePackage>;

export type WorkspacePackages = Map<string, WorkspacePackagesByVersion>;

// This weight is set for selectors that are used on direct dependencies.
// It is important to give a bigger weight to direct dependencies.
export const DIRECT_DEP_SELECTOR_WEIGHT = 1000;

export type VersionSelectorType = 'version' | 'range' | 'tag';

export type VersionSelectors = {
  [selector: string]: VersionSelectorWithWeight | VersionSelectorType;
};

export type VersionSelectorWithWeight = {
  selectorType: VersionSelectorType;
  weight: number;
};

export type PreferredVersions = {
  [packageName: string]: VersionSelectors;
};

export type ResolveOptions = {
  alwaysTryWorkspacePackages?: boolean | undefined;
  defaultTag?: string | undefined;
  pickLowestVersion?: boolean | undefined;
  publishedBy?: Date | undefined;
  projectDir: string;
  lockfileDir: LockFileDir;
  preferredVersions: PreferredVersions;
  preferWorkspacePackages?: boolean | undefined;
  registry: string;
  workspacePackages?: WorkspacePackages | undefined;
  updateToLatest?: boolean | undefined;
  injectWorkspacePackages?: boolean | undefined;
};

export type ResolveFunction = (
  wantedDependency: WantedDependency,
  opts: ResolveOptions
) => Promise<ResolveResult | WorkspaceResolveResult>;
