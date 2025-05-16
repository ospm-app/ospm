import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHexHash } from '../crypto.hash/index.ts';
import { OspmError } from '../error/index.ts';
import { logger } from '../logger/index.ts';
import gfs from '../graceful-fs/index.ts';
import type { VersionSelectors } from '../resolver-base/index.ts';
import type { PackageManifest } from '../types/index.ts';
import getRegistryName from 'encode-registry';
import { loadJsonFile } from 'load-json-file';
import pLimit, { type LimitFunction } from 'p-limit';
import { fastPathTemp as pathTemp } from 'path-temp';
import pick from 'ramda/src/pick';
import semver from 'semver';
import renameOverwrite from 'rename-overwrite';
import { toRaw } from './toRaw.ts';
import {
  pickPackageFromMeta,
  pickVersionByVersionRange,
  pickLowestVersionByVersionRange,
} from './pickPackageFromMeta.ts';
import type { RegistryPackageSpec } from './parsePref.ts';

export type PackageMeta = {
  name: string;
  'dist-tags': Record<string, string>;
  versions?: Record<string, PackageInRegistry> | undefined;
  time?: PackageMetaTime | undefined;
  cachedAt?: number | undefined;
};

export type PackageMetaTime = Record<string, string> & {
  unpublished?:
    | {
        time: string;
        versions: string[];
      }
    | undefined;
};

export type PackageMetaCache = {
  get: (key: string) => PackageMeta | undefined;
  set: (key: string, meta: PackageMeta) => void;
  has: (key: string) => boolean;
};

export interface PackageInRegistry extends PackageManifest {
  hasInstallScript?: boolean | undefined;
  dist: {
    integrity?: string | undefined;
    shasum: string;
    tarball: string;
  };
}

interface RefCountedLimiter {
  count: number;
  limit: LimitFunction;
}

/**
 * prevents simultaneous operations on the meta.json
 * otherwise it would cause EPERM exceptions
 */
const metafileOperationLimits = {} as {
  [pkgMirror: string]: RefCountedLimiter | undefined;
};

/**
 * To prevent metafileOperationLimits from holding onto objects in memory on
 * the order of the number of packages, refcount the limiters and drop them
 * once they are no longer needed. Callers of this function should ensure
 * that the limiter is no longer referenced once fn's Promise has resolved.
 */
async function runLimited<T>(
  pkgMirror: string,
  fn: (limit: LimitFunction) => Promise<T>
): Promise<T> {
  let entry: RefCountedLimiter | undefined;

  try {
    entry = metafileOperationLimits[pkgMirror] ??= {
      count: 0,
      limit: pLimit(1),
    };
    entry.count++;
    return await fn(entry.limit);
  } finally {
    if (typeof entry === 'undefined') {
      entry = {
        count: 0,
        limit: pLimit(1),
      };
    }

    entry.count--;

    if (entry.count === 0) {
      metafileOperationLimits[pkgMirror] = undefined;
    }
  }
}

export type PickPackageOptions = {
  authHeaderValue?: string | undefined;
  publishedBy?: Date | undefined;
  preferredVersionSelectors?: VersionSelectors | undefined;
  pickLowestVersion?: boolean | undefined;
  registry: string;
  dryRun: boolean;
  updateToLatest?: boolean | undefined;
};

function pickPackageFromMetaUsingTime(
  spec: RegistryPackageSpec,
  preferredVersionSelectors: VersionSelectors | undefined,
  meta: PackageMeta,
  publishedBy?: Date | undefined
): PackageInRegistry | undefined {
  const pickedPackage = pickPackageFromMeta(
    pickVersionByVersionRange,
    spec,
    preferredVersionSelectors,
    meta,
    publishedBy
  );

  if (pickedPackage) {
    return pickedPackage;
  }

  return pickPackageFromMeta(
    pickLowestVersionByVersionRange,
    spec,
    preferredVersionSelectors,
    meta,
    publishedBy
  );
}

export async function pickPackage(
  ctx: {
    fetch: (
      pkgName: string,
      registry: string,
      authHeaderValue?: string | undefined
    ) => Promise<PackageMeta>;
    metaDir: string;
    metaCache: PackageMetaCache;
    cacheDir: string;
    offline?: boolean | undefined;
    preferOffline?: boolean | undefined;
    filterMetadata?: boolean | undefined;
  },
  spec: RegistryPackageSpec,
  opts?: PickPackageOptions | undefined
): Promise<{
  meta: PackageMeta;
  pickedPackage?: PackageInRegistry | undefined;
}> {
  const newOpts = opts;

  let _pickPackageFromMeta =
    typeof newOpts?.publishedBy === 'undefined'
      ? pickPackageFromMeta.bind(
          null,
          newOpts?.pickLowestVersion === true
            ? pickLowestVersionByVersionRange
            : pickVersionByVersionRange
        )
      : pickPackageFromMetaUsingTime;

  if (newOpts?.updateToLatest === true) {
    const _pickPackageBase = _pickPackageFromMeta;
    _pickPackageFromMeta = (spec, ...rest) => {
      const latestStableSpec: RegistryPackageSpec = {
        ...spec,
        type: 'tag',
        fetchSpec: 'latest',
      };
      const latestStable = _pickPackageBase(latestStableSpec, ...rest);
      const current = _pickPackageBase(spec, ...rest);

      if (!latestStable) return current;
      if (!current) return latestStable;
      if (semver.lt(latestStable.version, current.version)) return current;
      return latestStable;
    };
  }

  validatePackageName(spec.name);

  const cachedMeta = ctx.metaCache.get(spec.name);
  if (cachedMeta != null) {
    return {
      meta: cachedMeta,
      pickedPackage: _pickPackageFromMeta(
        spec,
        newOpts?.preferredVersionSelectors,
        cachedMeta,
        newOpts?.publishedBy
      ),
    };
  }

  const registryName = getRegistryName(newOpts?.registry ?? '');

  const pkgMirror = path.join(
    ctx.cacheDir,
    ctx.metaDir,
    registryName,
    `${encodePkgName(spec.name)}.json`
  );

  return runLimited(pkgMirror, async (limit) => {
    let metaCachedInStore: PackageMeta | null | undefined;
    if (
      ctx.offline === true ||
      ctx.preferOffline === true ||
      newOpts?.pickLowestVersion === true
    ) {
      metaCachedInStore = await limit(async () => loadMeta(pkgMirror));

      if (ctx.offline === true) {
        if (metaCachedInStore != null)
          return {
            meta: metaCachedInStore,
            pickedPackage: _pickPackageFromMeta(
              spec,
              newOpts?.preferredVersionSelectors,
              metaCachedInStore,
              newOpts?.publishedBy
            ),
          };

        throw new OspmError(
          'NO_OFFLINE_META',
          `Failed to resolve ${toRaw(spec)} in package mirror ${pkgMirror}`
        );
      }

      if (metaCachedInStore != null) {
        const pickedPackage = _pickPackageFromMeta(
          spec,
          newOpts?.preferredVersionSelectors,
          metaCachedInStore,
          newOpts?.publishedBy
        );

        if (pickedPackage) {
          return {
            meta: metaCachedInStore,
            pickedPackage,
          };
        }
      }
    }

    if (newOpts?.updateToLatest !== true && spec.type === 'version') {
      metaCachedInStore =
        metaCachedInStore ?? (await limit(async () => loadMeta(pkgMirror)));
      // use the cached meta only if it has the required package version
      // otherwise it is probably out of date
      if (metaCachedInStore?.versions?.[spec.fetchSpec] != null) {
        return {
          meta: metaCachedInStore,
          pickedPackage: metaCachedInStore.versions[spec.fetchSpec],
        };
      }
    }
    if (newOpts?.publishedBy) {
      metaCachedInStore =
        metaCachedInStore ?? (await limit(async () => loadMeta(pkgMirror)));
      if (
        typeof metaCachedInStore?.cachedAt === 'number' &&
        new Date(metaCachedInStore.cachedAt) >= newOpts.publishedBy
      ) {
        const pickedPackage = _pickPackageFromMeta(
          spec,
          newOpts.preferredVersionSelectors,
          metaCachedInStore,
          newOpts.publishedBy
        );

        if (pickedPackage) {
          return {
            meta: metaCachedInStore,
            pickedPackage,
          };
        }
      }
    }

    try {
      let meta = await ctx.fetch(
        spec.name,
        newOpts?.registry ?? '',
        newOpts?.authHeaderValue
      );

      if (ctx.filterMetadata === true) {
        meta = clearMeta(meta);
      }

      meta.cachedAt = Date.now();
      // only save meta to cache, when it is fresh
      ctx.metaCache.set(spec.name, meta);

      if (newOpts?.dryRun !== true) {
        // We stringify this meta here to avoid saving any mutations that could happen to the meta object.
        const stringifiedMeta = JSON.stringify(meta);

        runLimited(pkgMirror, (limit: LimitFunction) => {
          return limit(async () => {
            try {
              await saveMeta(pkgMirror, stringifiedMeta);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
            } catch (_err: any) {
              // We don't care if this file was not written to the cache
            }
          });
        });
      }
      return {
        meta,
        pickedPackage: _pickPackageFromMeta(
          spec,
          newOpts?.preferredVersionSelectors,
          meta,
          newOpts?.publishedBy
        ),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      err.spec = spec;

      const meta = await loadMeta(pkgMirror); // TODO: add test for this usecase

      if (meta == null) {
        throw err;
      }

      logger.error(err, err);

      logger.debug({ message: `Using cached meta from ${pkgMirror}` });

      return {
        meta,
        pickedPackage: _pickPackageFromMeta(
          spec,
          newOpts?.preferredVersionSelectors,
          meta,
          newOpts?.publishedBy
        ),
      };
    }
  });
}

function clearMeta(pkg: PackageMeta): PackageMeta {
  const versions: PackageMeta['versions'] = {};
  for (const [version, info] of Object.entries(pkg.versions ?? {})) {
    // The list taken from https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-version-object
    // with the addition of 'libc'
    versions[version] = pick.default(
      [
        'name',
        'version',
        'bin',
        'directories',
        'devDependencies',
        'optionalDependencies',
        'dependencies',
        'peerDependencies',
        'dist',
        'engines',
        'peerDependenciesMeta',
        'cpu',
        'os',
        'libc',
        'deprecated',
        'bundleDependencies',
        'bundledDependencies',
        'hasInstallScript',
      ],
      info
    );
  }

  return {
    name: pkg.name,
    'dist-tags': pkg['dist-tags'],
    versions,
    time: pkg.time,
    cachedAt: pkg.cachedAt,
  };
}

function encodePkgName(pkgName: string): string {
  if (pkgName !== pkgName.toLowerCase()) {
    return `${pkgName}_${createHexHash(pkgName)}`;
  }

  return pkgName;
}

async function loadMeta(pkgMirror: string): Promise<PackageMeta | null> {
  try {
    return await loadJsonFile<PackageMeta>(pkgMirror);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    return null;
  }
}

const createdDirs = new Set<string>();

async function saveMeta(pkgMirror: string, meta: string): Promise<void> {
  const dir = path.dirname(pkgMirror);

  if (!createdDirs.has(dir)) {
    await fs.mkdir(dir, { recursive: true });
    createdDirs.add(dir);
  }

  const temp = pathTemp(pkgMirror);
  await gfs.writeFile(temp, meta);
  await renameOverwrite(temp, pkgMirror);
}

function validatePackageName(pkgName: string): void {
  if (pkgName.includes('/') && !pkgName.startsWith('@')) {
    throw new OspmError(
      'INVALID_PACKAGE_NAME',
      `Package name ${pkgName} is invalid, it should have a @scope`
    );
  }
}
