import path from 'node:path';
import {
  FULL_META_DIR,
  FULL_FILTERED_META_DIR,
  ABBREVIATED_META_DIR,
} from '../constants/index.ts';
import { PnpmError } from '../error/index.ts';
import type {
  FetchFromRegistry,
  GetAuthHeader,
  RetryTimeoutOptions,
} from '../fetching-types/index.ts';
import { resolveWorkspaceRange } from '../resolve-workspace-range/index.ts';
import type {
  PreferredVersions,
  ResolveResult,
  WorkspacePackage,
  WorkspacePackages,
  WorkspacePackagesByVersion,
  WorkspaceResolveResult,
} from '../resolver-base/index.ts';
import { LRUCache } from 'lru-cache';
import normalize from 'normalize-path';
import pMemoize from 'p-memoize';
import clone from 'ramda/src/clone';
import semver from 'semver';
import ssri from 'ssri';
import {
  type PackageInRegistry,
  type PackageMeta,
  type PackageMetaCache,
  type PickPackageOptions,
  pickPackage,
} from './pickPackage.ts';
import { parsePref, type RegistryPackageSpec } from './parsePref.ts';
import { fromRegistry, RegistryResponseError } from './fetch.ts';
import { workspacePrefToNpm } from './workspacePrefToNpm.ts';
import type { WantedDependency } from '../resolve-dependencies/index.ts';
import type { PkgResolutionId } from '../types/misc.ts';
import type { LockFileDir } from '../types/project.ts';

export class NoMatchingVersionError extends PnpmError {
  readonly packageMeta: PackageMeta;
  constructor(opts: {
    wantedDependency: WantedDependency;
    packageMeta: PackageMeta;
    registry: string;
  }) {
    const dep =
      typeof opts.wantedDependency.alias === 'string'
        ? `${opts.wantedDependency.alias}@${opts.wantedDependency.pref ?? ''}`
        : (opts.wantedDependency.pref ?? '');

    super(
      'NO_MATCHING_VERSION',
      `No matching version found for ${dep} while fetching it from ${opts.registry}`
    );
    this.packageMeta = opts.packageMeta;
  }
}

export {
  parsePref,
  workspacePrefToNpm,
  type PackageMeta,
  type PackageMetaCache,
  type RegistryPackageSpec,
  RegistryResponseError,
};

export type ResolverFactoryOptions = {
  cacheDir: string;
  fullMetadata?: boolean | undefined;
  filterMetadata?: boolean | undefined;
  offline?: boolean | undefined;
  preferOffline?: boolean | undefined;
  retry?: RetryTimeoutOptions | undefined;
  timeout?: number | undefined;
};

export type NpmResolver = (
  wantedDependency: WantedDependency,
  opts: ResolveFromNpmOptions
) => Promise<ResolveResult | WorkspaceResolveResult | null>;

export function createNpmResolver(
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: GetAuthHeader,
  opts: ResolverFactoryOptions
): { resolveFromNpm: NpmResolver; clearCache: () => void } {
  if (typeof opts.cacheDir !== 'string') {
    throw new TypeError('`opts.cacheDir` is required and needs to be a string');
  }

  const fetchOpts = {
    retry: opts.retry ?? {},
    timeout: opts.timeout ?? 60_000,
  };

  const fetch = pMemoize(
    fromRegistry.bind(null, fetchFromRegistry, fetchOpts),
    {
      cacheKey: (...args): string => {
        return JSON.stringify(args);
      },
      // @ts-expect-error Object literal may only specify known properties, and 'maxAge' does not exist in type 'Options<(pkgName: string, registry: string, authHeaderValue?: string | undefined) => Promise<PackageMeta>, string>'.ts(2353)
      maxAge: 1_000 * 20, // 20 seconds
    }
  );

  const metaCache = new LRUCache<string, PackageMeta>({
    max: 10_000,
    ttl: 120 * 1_000, // 2 minutes
  });

  return {
    resolveFromNpm: resolveNpm.bind(null, {
      getAuthHeaderValueByURI: getAuthHeader,
      pickPackage: pickPackage.bind(null, {
        fetch,
        filterMetadata: opts.filterMetadata,
        metaCache,
        metaDir:
          opts.fullMetadata === true
            ? opts.filterMetadata === true
              ? FULL_FILTERED_META_DIR
              : FULL_META_DIR
            : ABBREVIATED_META_DIR,
        offline: opts.offline,
        preferOffline: opts.preferOffline,
        cacheDir: opts.cacheDir,
      }),
    }),
    clearCache: (): void => {
      metaCache.clear();
    },
  };
}

export type ResolveFromNpmOptions = {
  alwaysTryWorkspacePackages?: boolean | undefined;
  defaultTag?: string | undefined;
  publishedBy?: Date | undefined;
  pickLowestVersion?: boolean | undefined;
  dryRun?: boolean | undefined;
  lockfileDir: LockFileDir;
  registry: string;
  preferredVersions?: PreferredVersions | undefined;
  preferWorkspacePackages?: boolean | undefined;
  updateToLatest?: boolean | undefined;
  injectWorkspacePackages?: boolean | undefined;
} & (
  | {
      projectDir?: string | undefined;
      workspacePackages?: undefined | undefined;
    }
  | {
      projectDir: string;
      workspacePackages: WorkspacePackages;
    }
);

async function resolveNpm(
  ctx: {
    pickPackage: (
      spec: RegistryPackageSpec,
      opts: PickPackageOptions
    ) => ReturnType<typeof pickPackage>;
    getAuthHeaderValueByURI: (registry: string) => string | undefined;
  },
  wantedDependency: WantedDependency & { injected?: boolean | undefined },
  opts: ResolveFromNpmOptions
): Promise<ResolveResult | WorkspaceResolveResult | null> {
  const defaultTag = opts.defaultTag ?? 'latest';

  if (wantedDependency.pref?.startsWith('workspace:') === true) {
    if (wantedDependency.pref.startsWith('workspace:.')) {
      return null;
    }

    const resolvedFromWorkspace = tryResolveFromWorkspace(wantedDependency, {
      defaultTag,
      lockfileDir: opts.lockfileDir,
      projectDir: opts.projectDir,
      registry: opts.registry,
      workspacePackages: opts.workspacePackages,
      injectWorkspacePackages: opts.injectWorkspacePackages,
    });

    if (resolvedFromWorkspace != null) {
      return resolvedFromWorkspace;
    }
  }

  const workspacePackages =
    opts.alwaysTryWorkspacePackages === true
      ? opts.workspacePackages
      : undefined;

  if (typeof wantedDependency.alias !== 'string') {
    return null;
  }

  const spec =
    typeof wantedDependency.pref === 'string' && wantedDependency.pref !== ''
      ? parsePref(
          wantedDependency.pref,
          wantedDependency.alias,
          defaultTag,
          opts.registry
        )
      : defaultTagForAlias(wantedDependency.alias, defaultTag);

  if (spec == null) {
    return null;
  }

  const authHeaderValue = ctx.getAuthHeaderValueByURI(opts.registry);

  let pickResult:
    | {
        meta: PackageMeta;
        pickedPackage?: PackageInRegistry | undefined;
      }
    | undefined;
  try {
    pickResult = await ctx.pickPackage(spec, {
      pickLowestVersion: opts.pickLowestVersion,
      publishedBy: opts.publishedBy,
      authHeaderValue,
      dryRun: opts.dryRun === true,
      preferredVersionSelectors: opts.preferredVersions?.[spec.name],
      registry: opts.registry,
      updateToLatest: opts.updateToLatest,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (
      typeof workspacePackages !== 'undefined' &&
      typeof opts.projectDir === 'string'
    ) {
      try {
        return tryResolveFromWorkspacePackages(workspacePackages, spec, {
          wantedDependency,
          projectDir: opts.projectDir,
          lockfileDir: opts.lockfileDir,
          hardLinkLocalPackages:
            opts.injectWorkspacePackages === true || wantedDependency.injected,
        });
      } catch {
        // ignore
      }
    }

    throw err;
  }

  const pickedPackage = pickResult.pickedPackage;

  const meta = pickResult.meta;

  if (pickedPackage == null) {
    if (
      typeof workspacePackages !== 'undefined' &&
      typeof opts.projectDir === 'string'
    ) {
      try {
        return tryResolveFromWorkspacePackages(workspacePackages, spec, {
          wantedDependency,
          projectDir: opts.projectDir,
          lockfileDir: opts.lockfileDir,
          hardLinkLocalPackages:
            opts.injectWorkspacePackages === true || wantedDependency.injected,
        });
      } catch {
        // ignore
      }
    }
    throw new NoMatchingVersionError({
      wantedDependency,
      packageMeta: meta,
      registry: opts.registry,
    });
  }

  const workspacePkgsMatchingName = workspacePackages?.get(pickedPackage.name);
  if (workspacePkgsMatchingName && typeof opts.projectDir === 'string') {
    const matchedPkg = workspacePkgsMatchingName.get(pickedPackage.version);

    if (matchedPkg) {
      return {
        ...resolveFromLocalPackage(matchedPkg, spec.normalizedPref, {
          projectDir: opts.projectDir,
          lockfileDir: opts.lockfileDir,
          hardLinkLocalPackages:
            opts.injectWorkspacePackages === true || wantedDependency.injected,
        }),
        latest: meta['dist-tags'].latest,
      };
    }

    const localVersion = pickMatchingLocalVersionOrNull(
      workspacePkgsMatchingName,
      spec
    );

    if (
      localVersion !== null &&
      (semver.gt(localVersion, pickedPackage.version) ||
        opts.preferWorkspacePackages === true)
    ) {
      const wp = workspacePkgsMatchingName.get(localVersion);

      if (wp === undefined) {
        throw new Error(`Workspace package not found for ${localVersion}`);
      }

      return {
        ...resolveFromLocalPackage(wp, spec.normalizedPref, {
          projectDir: opts.projectDir,
          lockfileDir: opts.lockfileDir,
          hardLinkLocalPackages:
            opts.injectWorkspacePackages === true || wantedDependency.injected,
        }),
        latest: meta['dist-tags'].latest,
      };
    }
  }

  const id =
    `${pickedPackage.name}@${pickedPackage.version}` as PkgResolutionId;

  const resolution = {
    integrity: getIntegrity(pickedPackage.dist),
    tarball: pickedPackage.dist.tarball,
  };
  return {
    id,
    latest: meta['dist-tags'].latest,
    manifest: pickedPackage,
    normalizedPref: spec.normalizedPref,
    resolution,
    resolvedVia: 'npm-registry',
    publishedAt: meta.time?.[pickedPackage.version],
  };
}

function tryResolveFromWorkspace(
  wantedDependency: WantedDependency & { injected?: boolean | undefined },
  opts: {
    defaultTag: string;
    lockfileDir: LockFileDir;
    projectDir?: string | undefined;
    registry: string;
    workspacePackages?: WorkspacePackages | undefined;
    injectWorkspacePackages?: boolean | undefined;
  }
): WorkspaceResolveResult | null {
  if (wantedDependency.pref?.startsWith('workspace:') !== true) {
    return null;
  }

  const pref = workspacePrefToNpm(wantedDependency.pref);

  const spec = parsePref(
    pref,
    wantedDependency.alias,
    opts.defaultTag,
    opts.registry
  );

  if (spec == null) {
    throw new Error(`Invalid workspace: spec (${wantedDependency.pref})`);
  }

  if (opts.workspacePackages == null) {
    throw new Error(
      'Cannot resolve package from workspace because opts.workspacePackages is not defined'
    );
  }
  if (typeof opts.projectDir === 'undefined') {
    throw new Error(
      'Cannot resolve package from workspace because opts.projectDir is not defined'
    );
  }

  return tryResolveFromWorkspacePackages(opts.workspacePackages, spec, {
    wantedDependency,
    projectDir: opts.projectDir,
    hardLinkLocalPackages:
      opts.injectWorkspacePackages === true || wantedDependency.injected,
    lockfileDir: opts.lockfileDir,
  });
}

function tryResolveFromWorkspacePackages(
  workspacePackages: WorkspacePackages,
  spec: RegistryPackageSpec,
  opts: {
    wantedDependency: WantedDependency;
    hardLinkLocalPackages?: boolean | undefined;
    projectDir: string;
    lockfileDir: LockFileDir;
  }
): WorkspaceResolveResult {
  const workspacePkgsMatchingName = workspacePackages.get(spec.name);

  if (typeof workspacePkgsMatchingName === 'undefined') {
    throw new PnpmError(
      'WORKSPACE_PKG_NOT_FOUND',
      `In ${path.relative(process.cwd(), opts.projectDir)}: "${spec.name}@${opts.wantedDependency.pref ?? ''}" is in the dependencies but no package named "${spec.name}" is present in the workspace`,
      {
        hint: `Packages found in the workspace: ${Object.keys(workspacePackages).join(', ')}`,
      }
    );
  }

  const localVersion = pickMatchingLocalVersionOrNull(
    workspacePkgsMatchingName,
    spec
  );

  if (localVersion === null) {
    throw new PnpmError(
      'NO_MATCHING_VERSION_INSIDE_WORKSPACE',
      `In ${path.relative(process.cwd(), opts.projectDir)}: No matching version found for ${opts.wantedDependency.alias ?? ''}@${opts.wantedDependency.pref ?? ''} inside the workspace`
    );
  }

  const wp = workspacePkgsMatchingName.get(localVersion);

  if (wp === undefined) {
    throw new Error(`Workspace package not found for ${localVersion}`);
  }

  return resolveFromLocalPackage(wp, spec.normalizedPref, opts);
}

function pickMatchingLocalVersionOrNull(
  versions: WorkspacePackagesByVersion,
  spec: RegistryPackageSpec
): string | null {
  switch (spec.type) {
    case 'tag':
      return semver.maxSatisfying(Array.from(versions.keys()), '*', {
        includePrerelease: true,
      });
    case 'version':
      return versions.has(spec.fetchSpec) ? spec.fetchSpec : null;
    case 'range':
      return resolveWorkspaceRange(spec.fetchSpec, Array.from(versions.keys()));
    default:
      return null;
  }
}

function resolveFromLocalPackage(
  localPackage: WorkspacePackage,
  normalizedPref: string | undefined,
  opts: {
    hardLinkLocalPackages?: boolean | undefined;
    projectDir: string;
    lockfileDir: LockFileDir;
  }
): WorkspaceResolveResult {
  let id: PkgResolutionId | undefined;

  let directory: string | undefined;

  const localPackageDir = resolveLocalPackageDir(localPackage);

  if (opts.hardLinkLocalPackages === true) {
    directory = normalize(path.relative(opts.lockfileDir, localPackageDir));

    id = `file:${directory}` as PkgResolutionId;
  } else {
    directory = localPackageDir;
    id =
      `link:${normalize(path.relative(opts.projectDir, localPackageDir))}` as PkgResolutionId;
  }

  return {
    id,
    manifest: clone.default(localPackage.manifest),
    normalizedPref,
    resolution: {
      directory,
      type: 'directory',
    },
    resolvedVia: 'workspace',
  };
}

function resolveLocalPackageDir(localPackage: WorkspacePackage): string {
  if (
    localPackage.manifest.publishConfig?.directory == null ||
    localPackage.manifest.publishConfig.linkDirectory === false
  ) {
    return localPackage.rootDir;
  }

  return path.join(
    localPackage.rootDir,
    localPackage.manifest.publishConfig.directory
  );
}

function defaultTagForAlias(
  alias: string,
  defaultTag: string
): RegistryPackageSpec {
  return {
    fetchSpec: defaultTag,
    name: alias,
    type: 'tag',
  };
}

function getIntegrity(dist: {
  integrity?: string | undefined;
  shasum: string;
  tarball: string;
}): string | undefined {
  if (typeof dist.integrity === 'string') {
    return dist.integrity;
  }

  if (!dist.shasum) {
    return undefined;
  }

  const integrity = ssri.fromHex(dist.shasum, 'sha1');

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
  if (!integrity) {
    throw new PnpmError(
      'INVALID_TARBALL_INTEGRITY',
      `Tarball "${dist.tarball}" has invalid shasum specified in its metadata: ${dist.shasum}`
    );
  }

  return integrity.toString();
}
