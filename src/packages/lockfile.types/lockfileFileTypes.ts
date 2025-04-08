import type {
  LockfileBase,
  LockfilePackageInfo,
  LockfilePackageSnapshot,
  ProjectSnapshotBase,
} from './index.ts';

export interface LockfileFile extends LockfileBase {
  importers?: Record<string, LockfileFileProjectSnapshot> | undefined;
  packages?: Record<string, LockfilePackageInfo> | undefined;
  snapshots?: Record<string, LockfilePackageSnapshot> | undefined;
}

/**
 * Similar to the current ProjectSnapshot interface, but omits the "specifiers"
 * field in favor of inlining each specifier next to its version resolution in
 * dependency blocks.
 */
export interface LockfileFileProjectSnapshot extends ProjectSnapshotBase {
  dependencies?: LockfileFileProjectResolvedDependencies | undefined;
  devDependencies?: LockfileFileProjectResolvedDependencies | undefined;
  optionalDependencies?: LockfileFileProjectResolvedDependencies | undefined;
}

export type LockfileFileProjectResolvedDependencies = {
  [depName: string]: SpecifierAndResolution;
};

export type SpecifierAndResolution = {
  specifier: string;
  version: string;
};
