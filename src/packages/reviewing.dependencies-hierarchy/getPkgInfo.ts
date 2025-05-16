import path from 'node:path';
import {
  nameVerFromPkgSnapshot,
  pkgSnapshotToResolution,
} from '../lockfile.utils/index.ts';
import { type DepTypes, DepType } from '../lockfile.detect-dep-types/index.ts';
import type { Registries } from '../types/index.ts';
import { depPathToFilename, refToRelative } from '../dependency-path/index.ts';
import normalizePath from 'normalize-path';
import type {
  PackageSnapshots,
  PackageSnapshot,
} from '../lockfile.types/index.ts';

export type GetPkgInfoOpts = {
  readonly alias: string;
  readonly ref: string;
  readonly currentPackages: PackageSnapshots;
  readonly peers?: Set<string> | undefined;
  readonly registries: Registries;
  readonly skipped: Set<string>;
  readonly wantedPackages: PackageSnapshots;
  readonly virtualStoreDir?: string | undefined;
  readonly virtualStoreDirMaxLength: number;
  readonly depTypes: DepTypes;

  /**
   * The base dir if the `ref` argument is a `"link:"` relative path.
   */
  readonly linkedPathBaseDir: string;

  /**
   * If the `ref` argument is a `"link:"` relative path, the ref is reused for
   * the version field. (Since the true semver may not be known.)
   *
   * Optionally rewrite this relative path to a base dir before writing it to
   * version.
   */
  readonly rewriteLinkVersionDir?: string;
};

export function getPkgInfo(opts: GetPkgInfoOpts): PackageInfo {
  let name!: string;
  let version: string;
  let resolved: string | undefined;
  let depType: DepType | undefined;
  let optional: boolean | undefined;
  let isSkipped = false;
  let isMissing = false;

  const depPath = refToRelative(opts.ref, opts.alias);

  if (depPath !== null) {
    let pkgSnapshot: PackageSnapshot | undefined;

    if (opts.currentPackages[depPath]) {
      pkgSnapshot = opts.currentPackages[depPath];
      const parsed = nameVerFromPkgSnapshot(depPath, pkgSnapshot);
      name = parsed.name;
      version = parsed.version;
    } else {
      pkgSnapshot = opts.wantedPackages[depPath];

      if (typeof pkgSnapshot === 'undefined') {
        name = opts.alias;
        version = opts.ref;
      } else {
        const parsed = nameVerFromPkgSnapshot(depPath, pkgSnapshot);
        name = parsed.name;
        version = parsed.version;
      }

      isMissing = true;

      isSkipped = opts.skipped.has(depPath);
    }

    if (typeof pkgSnapshot !== 'undefined') {
      resolved = pkgSnapshotToResolution(
        depPath,
        pkgSnapshot,
        opts.registries
      )?.tarball;
    }

    depType = opts.depTypes[depPath];

    optional = pkgSnapshot?.optional;
  } else {
    name = opts.alias;

    version = opts.ref;
  }

  if (!version) {
    version = opts.ref;
  }

  const fullPackagePath = depPath
    ? path.join(
        opts.virtualStoreDir ?? '.ospm',
        depPathToFilename(depPath, opts.virtualStoreDirMaxLength),
        'node_modules',
        name
      )
    : path.join(opts.linkedPathBaseDir, opts.ref.slice(5));

  if (
    version.startsWith('link:') &&
    typeof opts.rewriteLinkVersionDir === 'string'
  ) {
    version = `link:${normalizePath(path.relative(opts.rewriteLinkVersionDir, fullPackagePath))}`;
  }

  const packageInfo: PackageInfo = {
    alias: opts.alias,
    isMissing,
    isPeer: Boolean(opts.peers?.has(opts.alias)),
    isSkipped,
    name,
    path: fullPackagePath,
    version,
  };

  if (typeof resolved === 'string') {
    packageInfo.resolved = resolved;
  }

  if (optional === true) {
    packageInfo.optional = true;
  }

  if (depType === DepType.DevOnly) {
    packageInfo.dev = true;
  } else if (depType === DepType.ProdOnly) {
    packageInfo.dev = false;
  }

  return packageInfo;
}

type PackageInfo = {
  alias: string;
  isMissing: boolean;
  isPeer: boolean;
  isSkipped: boolean;
  name: string;
  path: string;
  version: string;
  resolved?: string | undefined;
  optional?: true | undefined;
  dev?: boolean | undefined;
};
