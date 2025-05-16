import type { ExecutionEnv } from './env.ts';

export type Dependencies = Record<string, string>;

export type PackageBin = string | { [commandName: string]: string };

export type PackageScripts = {
  [name: string]: string | undefined;
} & {
  prepublish?: string | undefined;
  prepare?: string | undefined;
  prepublishOnly?: string | undefined;
  prepack?: string | undefined;
  postpack?: string | undefined;
  publish?: string | undefined;
  postpublish?: string | undefined;
  preinstall?: string | undefined;
  install?: string | undefined;
  postinstall?: string | undefined;
  preuninstall?: string | undefined;
  uninstall?: string | undefined;
  postuninstall?: string | undefined;
  preversion?: string | undefined;
  version?: string | undefined;
  postversion?: string | undefined;
  pretest?: string | undefined;
  test?: string | undefined;
  posttest?: string | undefined;
  prestop?: string | undefined;
  stop?: string | undefined;
  poststop?: string | undefined;
  prestart?: string | undefined;
  start?: string | undefined;
  poststart?: string | undefined;
  prerestart?: string | undefined;
  restart?: string | undefined;
  postrestart?: string | undefined;
  preshrinkwrap?: string | undefined;
  shrinkwrap?: string | undefined;
  postshrinkwrap?: string | undefined;
};

export type PeerDependenciesMeta = {
  [dependencyName: string]: {
    optional?: boolean | undefined;
  };
};

export type DependenciesMeta = {
  [dependencyName: string]: {
    injected?: boolean | undefined;
    node?: string | undefined;
    patch?: string | undefined;
  };
};

export interface PublishConfig extends Record<string, unknown> {
  directory?: string | undefined;
  linkDirectory?: boolean | undefined;
  executableFiles?: string[] | undefined;
  registry?: string | undefined;
}

type Version = string;
type Pattern = string;

export type TypesVersions = {
  [version: Version]: {
    [pattern: Pattern]: string[];
  };
};

export type BaseManifest = {
  name: string;
  version: string;
  type?: string | undefined;
  bin?: PackageBin | undefined;
  description?: string | undefined;
  directories?:
    | {
        bin?: string | undefined;
      }
    | undefined;
  files?: string[] | undefined;
  funding?: string | undefined;
  dependencies?: Dependencies | undefined;
  devDependencies?: Dependencies | undefined;
  optionalDependencies?: Dependencies | undefined;
  peerDependencies?: Dependencies | undefined;
  peerDependenciesMeta?: PeerDependenciesMeta | undefined;
  dependenciesMeta?: DependenciesMeta | undefined;
  bundleDependencies?: string[] | boolean | undefined;
  bundledDependencies?: string[] | boolean | undefined;
  homepage?: string | undefined;
  repository?: string | { url: string } | undefined;
  bugs?:
    | string
    | {
        url?: string | undefined;
        email?: string | undefined;
      }
    | undefined;
  scripts?: PackageScripts | undefined;
  config?: object | undefined;
  engines?:
    | {
        node?: string | undefined;
        npm?: string | undefined;
        pnpm?: string | undefined;
        ospm?: string | undefined;
      }
    | undefined;
  cpu?: string[] | undefined;
  os?: string[] | undefined;
  libc?: string[] | undefined;
  main?: string | undefined;
  module?: string | undefined;
  typings?: string | undefined;
  types?: string | undefined;
  publishConfig?: PublishConfig | undefined;
  typesVersions?: TypesVersions | undefined;
  readme?: string | undefined;
  keywords?: string[] | undefined;
  author?:
    | string
    | { name: string; email?: string | undefined; url?: string | undefined }
    | undefined;
  license?: string | undefined;
  exports?: Record<string, string> | undefined;
  imports?: Record<string, unknown> | undefined;
};

export interface DependencyManifest extends BaseManifest {
  name: string;
  version: string;
}

export type PackageExtension = Pick<
  BaseManifest,
  | 'dependencies'
  | 'optionalDependencies'
  | 'peerDependencies'
  | 'peerDependenciesMeta'
>;

export type PeerDependencyRules = {
  ignoreMissing?: string[] | undefined;
  allowAny?: string[] | undefined;
  allowedVersions?: Record<string, string> | undefined;
};

export type AllowedDeprecatedVersions = Record<string, string>;

export type OspmSettings = {
  configDependencies?: Record<string, string> | undefined;
  neverBuiltDependencies?: string[] | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  onlyBuiltDependenciesFile?: string | undefined;
  ignoredBuiltDependencies?: string[] | undefined;
  overrides?: Record<string, string> | undefined;
  packageExtensions?: Record<string, PackageExtension> | undefined;
  ignoredOptionalDependencies?: string[] | undefined;
  peerDependencyRules?: PeerDependencyRules | undefined;
  allowedDeprecatedVersions?: AllowedDeprecatedVersions | undefined;
  allowNonAppliedPatches?: boolean | undefined;
  patchedDependencies?: Record<string, string> | undefined;
  updateConfig?:
    | {
        ignoreDependencies?: string[] | undefined;
      }
    | undefined;
  auditConfig?:
    | {
        ignoreCves?: string[] | undefined;
        ignoreGhsas?: string[] | undefined;
      }
    | undefined;
  requiredScripts?: string[] | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
  executionEnv?: ExecutionEnv | undefined;
};

export interface ProjectManifest extends BaseManifest {
  packageManager?: string | undefined;
  workspaces?: string[] | undefined;
  ospm?: OspmSettings | undefined;
  private?: boolean | undefined;
  resolutions?: Record<string, string> | undefined;
}

export interface PackageManifest extends DependencyManifest {
  deprecated?: string | undefined;
}

export type SupportedArchitectures = {
  os?: string[] | undefined;
  cpu?: string[] | undefined;
  libc?: string[] | undefined;
};
