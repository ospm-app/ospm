import type { PatchFile } from '../patching.types/index.ts';
import type { Resolution } from '../resolver-base/index.ts';
import type { DependenciesMeta, DepPath, ProjectId } from '../types/index.ts';

export type { PatchFile, ProjectId };

export * from './lockfileFileTypes.ts';

export type LockfileSettings = {
  autoInstallPeers?: boolean | undefined;
  excludeLinksFromLockfile?: boolean | undefined;
  peersSuffixMaxLength?: number | undefined;
  injectWorkspacePackages?: boolean | undefined;
};

export type LockfileBase = {
  catalogs?: CatalogSnapshots | undefined;
  ignoredOptionalDependencies?: string[] | undefined;
  lockfileVersion: string;
  overrides?: Record<string, string> | undefined;
  packageExtensionsChecksum?: string | undefined;
  patchedDependencies?: Record<string, PatchFile> | undefined;
  pnpmfileChecksum?: string | undefined;
  settings?: LockfileSettings | undefined;
  time?: Record<string, string> | undefined;
};

export interface LockfileObject extends LockfileBase {
  importers?: Record<ProjectId, ProjectSnapshot> | undefined;
  packages?: PackageSnapshots | undefined;
}

export type LockfilePackageSnapshot = {
  optional?: boolean | undefined;
  dependencies?: ResolvedDependencies | undefined;
  optionalDependencies?: ResolvedDependencies | undefined;
  transitivePeerDependencies?: string[] | undefined;
};

export type LockfilePackageInfo = {
  id?: string | undefined;
  patched?: boolean | undefined;
  hasBin?: boolean | undefined;
  // name and version are only needed
  // for packages that are hosted not in the npm registry
  name?: string | undefined;
  version?: string | undefined;
  resolution?: Resolution | undefined;
  peerDependencies?: Record<string, string> | undefined;
  peerDependenciesMeta?:
    | { [name: string]: { optional: boolean | undefined } }
    | undefined;
  bundledDependencies?: string[] | boolean | undefined;
  engines?:
    | (Record<string, string> & {
        node?: string | undefined;
      })
    | undefined;
  os?: string[] | undefined;
  cpu?: string[] | undefined;
  libc?: string[] | undefined;
  deprecated?: string | undefined;
};

export type ProjectSnapshotBase = {
  dependenciesMeta?: DependenciesMeta | undefined;
  publishDirectory?: string | undefined;
};

export interface ProjectSnapshot extends ProjectSnapshotBase {
  specifiers: ResolvedDependencies;
  dependencies?: ResolvedDependencies | undefined;
  optionalDependencies?: ResolvedDependencies | undefined;
  devDependencies?: ResolvedDependencies | undefined;
}

export type ResolvedDependenciesOfImporters = Record<
  string,
  { version: string; specifier: string }
>;

export type PackageSnapshots = {
  [packagePath: DepPath]: PackageSnapshot;
};

export type PackageSnapshot = LockfilePackageInfo & LockfilePackageSnapshot;

export type Dependencies = {
  [name: string]: string;
};

export type PackageBin = string | { [name: string]: string };

/** @example
 * {
 *   "foo": "registry.npmjs.org/foo/1.0.1"
 * }
 */
export type ResolvedDependencies = Record<string, string>;

export type CatalogSnapshots = {
  [catalogName: string]: { [dependencyName: string]: ResolvedCatalogEntry };
};

export type ResolvedCatalogEntry = {
  /**
   * The real specifier that should be used for this dependency's catalog entry.
   * This would be the ^1.2.3 portion of:
   *
   * @example
   * catalog:
   *   foo: ^1.2.3
   */
  readonly specifier: string;

  /**
   * The concrete version that the requested specifier resolved to. Ex: 1.2.3
   */
  readonly version: string;
};
