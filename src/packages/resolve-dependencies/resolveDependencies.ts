import path from 'node:path';
import {
  matchCatalogResolveResult,
  type CatalogResolution,
  type CatalogResolutionFound,
  type CatalogResolutionMisconfiguration,
  type CatalogResolver,
} from '../catalogs.resolver/index.ts';
import {
  deprecationLogger,
  progressLogger,
  skippedOptionalDependencyLogger,
} from '../core-loggers/index.ts';
import { PnpmError } from '../error/index.ts';
import type {
  LockfileObject,
  PackageSnapshot,
  ProjectSnapshot,
  ResolvedDependencies,
} from '../lockfile.types/index.ts';
import {
  nameVerFromPkgSnapshot,
  pkgSnapshotToResolution,
} from '../lockfile.utils/index.ts';
import { logger } from '../logger/index.ts';
import { getPatchInfo } from '../patching.config/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import {
  type DirectoryResolution,
  DIRECT_DEP_SELECTOR_WEIGHT,
  type PreferredVersions,
  type Resolution,
  type WorkspacePackages,
} from '../resolver-base/index.ts';
import type {
  PkgRequestFetchResult,
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import type {
  DepPath,
  SupportedArchitectures,
  AllowedDeprecatedVersions,
  PackageManifest,
  ReadPackageHook,
  Registries,
  PkgIdWithPatchHash,
  PkgResolutionId,
  LockFileDir,
  GlobalPkgDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import * as dp from '../dependency-path/index.ts';
import { getPreferredVersionsFromLockfileAndManifests } from '../lockfile.preferred-versions/index.ts';
import type { PatchGroupRecord, PatchInfo } from '../patching.types/index.ts';
import normalizePath from 'normalize-path';
import { pathExists } from 'path-exists';
import pDefer from 'p-defer';
import pShare from 'promise-share';
import partition from 'ramda/src/partition';
import pickBy from 'ramda/src/pickBy';
import omit from 'ramda/src/omit';
import zipWith from 'ramda/src/zipWith';
import semver from 'semver';
import { getNonDevWantedDependencies } from './getNonDevWantedDependencies.ts';
import { safeIntersect } from './mergePeers.ts';
import { type NodeId, nextNodeId } from './nextNodeId.ts';
import { parentIdsContainSequence } from './parentIdsContainSequence.ts';
import { hoistPeers, getHoistableOptionalPeers } from './hoistPeers.ts';
import { wantedDepIsLocallyAvailable } from './wantedDepIsLocallyAvailable.ts';
import type { CatalogLookupMetadata } from './resolveDependencyTree.ts';
import { replaceVersionInPref } from './replaceVersionInPref.ts';
import type { WantedDependency } from './getWantedDependencies.ts';

const dependencyResolvedLogger = logger('_dependency_resolved');

const omitDepsFields = omit.default([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
]);

export function getPkgsInfoFromIds(
  ids: PkgResolutionId[],
  resolvedPkgsById: ResolvedPkgsById
): Array<{ id: PkgResolutionId; name: string; version: string }> {
  return ids
    .slice(1)
    .map(
      (
        id: PkgResolutionId
      ): { id: PkgResolutionId; name: string; version: string } | undefined => {
        const pkg = resolvedPkgsById[id];

        if (typeof pkg === 'undefined') {
          return;
        }

        const { name, version } = pkg;

        return { id, name, version };
      }
    )
    .filter(Boolean);
}

// child nodeId by child alias name in case of non-linked deps
export type ChildrenMap = {
  [alias: string]: NodeId;
};

export type DependenciesTreeNode = {
  children: (() => ChildrenMap) | ChildrenMap;
  installable?: boolean | undefined;
} & (
  | {
      resolvedPackage: ResolvedPackage & { name: string; version: string };
      depth: number;
    }
  | {
      resolvedPackage: { name: string; version: string };
      depth: -1;
    }
);

export type DependenciesTree = Map<
  // a node ID is the join of the package's keypath with a colon
  // E.g., a subdeps node ID which parent is `foo` will be
  // registry.npmjs.org/foo/1.0.0:registry.npmjs.org/bar/1.0.0
  NodeId,
  DependenciesTreeNode
>;

export type ResolvedPkgsById = Record<PkgResolutionId, ResolvedPackage>;

export type LinkedDependency = {
  isLinkedDependency: true;
  optional?: boolean | undefined;
  dev?: boolean | undefined;
  resolution: DirectoryResolution;
  pkgId: PkgResolutionId;
  version: string;
  name: string;
  normalizedPref?: string | undefined;
  alias: string;
  catalogLookup?: CatalogLookupMetadata | undefined;
};

export type PendingNode = {
  alias: string;
  nodeId: NodeId;
  resolvedPackage: ResolvedPackage;
  depth: number;
  installable: boolean;
  parentIds: PkgResolutionId[];
};

export type ChildrenByParentId = {
  [id: PkgResolutionId]: Array<{
    alias: string;
    id: PkgResolutionId;
  }>;
};

export type ResolutionContext = {
  allPeerDepNames: Set<string>;
  autoInstallPeers: boolean;
  autoInstallPeersFromHighestMatch: boolean;
  allowedDeprecatedVersions: AllowedDeprecatedVersions;
  allPreferredVersions?: PreferredVersions | undefined;
  appliedPatches: Set<string>;
  updatedSet: Set<string>;
  catalogResolver: CatalogResolver;
  defaultTag: string;
  dryRun: boolean;
  forceFullResolution: boolean;
  ignoreScripts?: boolean | undefined;
  resolvedPkgsById: ResolvedPkgsById;
  outdatedDependencies: Record<PkgResolutionId, string>;
  childrenByParentId: ChildrenByParentId;
  patchedDependencies?: PatchGroupRecord | undefined;
  pendingNodes: PendingNode[];
  wantedLockfile: LockfileObject;
  currentLockfile: LockfileObject;
  injectWorkspacePackages?: boolean | undefined;
  linkWorkspacePackagesDepth: number;
  lockfileDir: LockFileDir;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  // the IDs of packages that are not installable
  skipped: Set<PkgResolutionId>;
  dependenciesTree: DependenciesTree;
  force: boolean;
  preferWorkspacePackages?: boolean | undefined;
  readPackageHook?: ReadPackageHook | undefined;
  engineStrict: boolean;
  nodeVersion?: string | undefined;
  pnpmVersion: string;
  registries: Registries;
  resolutionMode?: 'highest' | 'time-based' | 'lowest-direct' | undefined;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  workspacePackages?: WorkspacePackages | undefined;
  missingPeersOfChildrenByPkgId: Record<
    PkgResolutionId,
    { depth: number; missingPeersOfChildren: MissingPeersOfChildren }
  >;
  hoistPeers?: boolean | undefined;
};

export type MissingPeers = Record<string, { range: string; optional: boolean }>;

export type ResolvedPeers = Record<string, PkgAddress>;

type MissingPeersOfChildren = {
  resolve: (missingPeers: MissingPeers) => void;
  reject: (err: Error) => void;
  get: () => Promise<MissingPeers>;
  resolved?: boolean | undefined;
};

export type PkgAddress = {
  alias: string;
  depIsLinked: boolean;
  isNew: boolean;
  // isLinkedDependency?: false | undefined;
  nodeId: NodeId;
  pkgId: PkgResolutionId;
  normalizedPref?: string | undefined; // is returned only for root dependencies
  installable?: boolean | undefined;
  pkg: PackageManifest;
  // version?: string | undefined;
  updated: boolean;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  missingPeers: MissingPeers;
  missingPeersOfChildren?: MissingPeersOfChildren | undefined;
  publishedAt?: string | undefined;
  catalogLookup?: CatalogLookupMetadata | undefined;
  optional: boolean;
  isLinkedDependency?: undefined;
  version?: undefined;
};

export type PeerDependency = {
  version: string;
  optional?: boolean | undefined;
};

export type PeerDependencies = Record<string, PeerDependency>;

export type ResolvedPackage = {
  id: PkgResolutionId;
  isLeaf: boolean;
  resolution?: Resolution | undefined;
  prod: boolean;
  dev?: boolean | undefined;
  optional: boolean;
  fetching?: (() => Promise<PkgRequestFetchResult<unknown>>) | undefined;
  filesIndexFile?: string | undefined;
  name: string;
  version: string;
  peerDependencies: PeerDependencies;
  optionalDependencies: Set<string>;
  hasBin: boolean;
  hasBundledDependencies: boolean;
  patch?: PatchInfo | undefined;
  prepare: boolean;
  pkgIdWithPatchHash: PkgIdWithPatchHash;
  requiresBuild?: boolean | undefined;
  transitivePeerDependencies: Set<string>;
  additionalInfo: {
    deprecated?: string | undefined;
    bundleDependencies?: string[] | boolean | undefined;
    bundledDependencies?: string[] | boolean | undefined;
    engines?:
      | {
          node?: string | undefined;
          npm?: string | undefined;
        }
      | undefined;
    cpu?: string[] | undefined;
    os?: string[] | undefined;
    libc?: string[] | undefined;
  };
};

type ParentPkg = Pick<
  PkgAddress,
  'nodeId' | 'installable' | 'rootDir' | 'optional' | 'pkgId'
>;

export type ParentPkgAliases = Record<string, PkgAddress | true>;

export type UpdateMatchingFunction = (pkgName: string) => boolean;

type ResolvedDependenciesOptions = {
  currentDepth: number;
  parentIds: PkgResolutionId[];
  parentPkg: ParentPkg;
  parentPkgAliases: ParentPkgAliases;
  // If the package has been updated, the dependencies
  // which were used by the previous version are passed
  // via this option
  preferredDependencies?: ResolvedDependencies | undefined;
  proceed: boolean;
  publishedBy?: Date | undefined;
  pickLowestVersion?: boolean | undefined;
  resolvedDependencies?: ResolvedDependencies | undefined;
  updateMatching?: UpdateMatchingFunction | undefined;
  updateDepth: number;
  prefix: string;
  supportedArchitectures?: SupportedArchitectures | undefined;
  updateToLatest?: boolean | undefined;
};

type PostponedResolutionOpts = {
  preferredVersions: PreferredVersions;
  parentPkgAliases: ParentPkgAliases;
  publishedBy?: Date | undefined;
};

type PeersResolutionResult = {
  missingPeers: MissingPeers;
  resolvedPeers: ResolvedPeers;
};

type PostponedResolutionFunction = (
  opts: PostponedResolutionOpts
) => Promise<PeersResolutionResult>;
type PostponedPeersResolutionFunction = (
  parentPkgAliases: ParentPkgAliases
) => Promise<PeersResolutionResult>;

interface ResolvedRootDependenciesResult {
  pkgAddressesByImporters: Array<Array<PkgAddress | LinkedDependency>>;
  time?: Record<string, string> | undefined;
}

export async function resolveRootDependencies(
  ctx: ResolutionContext,
  importers: ImporterToResolve[]
): Promise<ResolvedRootDependenciesResult> {
  if (ctx.autoInstallPeers) {
    ctx.allPreferredVersions = getPreferredVersionsFromLockfileAndManifests(
      ctx.wantedLockfile.packages,
      []
    );
  } else if (ctx.hoistPeers === true) {
    ctx.allPreferredVersions = {};
  }

  const { pkgAddressesByImportersWithoutPeers, publishedBy, time } =
    await resolveDependenciesOfImporters(ctx, importers);

  if (ctx.hoistPeers !== true) {
    return {
      pkgAddressesByImporters: pkgAddressesByImportersWithoutPeers.map(
        ({ pkgAddresses }) => pkgAddresses
      ),
      time,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const allMissingOptionalPeersByImporters = (
      await Promise.all(
        pkgAddressesByImportersWithoutPeers.map(
          async (
            importerResolutionResult: PkgAddressesByImportersWithoutPeers,
            index: number
          ): Promise<Record<string, string[]> | null> => {
            const importer = importers[index];

            if (typeof importer === 'undefined') {
              return null;
            }

            const { parentPkgAliases, preferredVersions, options } = importer;

            const allMissingOptionalPeers: Record<string, string[]> = {};

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            while (true) {
              for (const pkgAddress of importerResolutionResult.pkgAddresses) {
                parentPkgAliases[pkgAddress.alias] = true;
              }

              const [missingOptionalPeers, missingRequiredPeers] =
                partition.default(
                  ([, { optional }]: [
                    string,
                    {
                      range: string;
                      optional: boolean;
                    },
                  ]): boolean => {
                    return optional;
                  },
                  Object.entries(importerResolutionResult.missingPeers)
                );

              for (const missingPeerName of Object.keys(missingRequiredPeers)) {
                parentPkgAliases[missingPeerName] = true;
              }

              if (ctx.autoInstallPeers) {
                // All the missing peers should get installed in the root.
                // Otherwise, pending nodes will not work.
                // even those peers should be hoisted that are not autoinstalled
                for (const [
                  resolvedPeerName,
                  resolvedPeerAddress,
                ] of Object.entries(importerResolutionResult.resolvedPeers)) {
                  if (
                    typeof parentPkgAliases[resolvedPeerName] === 'undefined'
                  ) {
                    importerResolutionResult.pkgAddresses.push(
                      resolvedPeerAddress
                    );
                  }
                }
              }

              for (const [
                missingOptionalPeerName,
                { range: missingOptionalPeerRange },
              ] of missingOptionalPeers) {
                if (!allMissingOptionalPeers[missingOptionalPeerName]) {
                  allMissingOptionalPeers[missingOptionalPeerName] = [
                    missingOptionalPeerRange,
                  ];
                } else if (
                  !allMissingOptionalPeers[missingOptionalPeerName].includes(
                    missingOptionalPeerRange
                  )
                ) {
                  allMissingOptionalPeers[missingOptionalPeerName].push(
                    missingOptionalPeerRange
                  );
                }
              }

              if (!missingRequiredPeers.length) {
                break;
              }

              const dependencies = hoistPeers(missingRequiredPeers, ctx);

              if (!Object.keys(dependencies).length) {
                break;
              }

              const wantedDependencies = getNonDevWantedDependencies({
                dependencies,
              });

              const resolveDependenciesResult = await resolveDependencies(
                ctx,
                preferredVersions,
                wantedDependencies,
                {
                  ...options,
                  parentPkgAliases,
                  publishedBy,
                  updateToLatest: false,
                }
              );

              importerResolutionResult.pkgAddresses.push(
                ...resolveDependenciesResult.pkgAddresses
              );

              Object.assign<
                PkgAddressesByImportersWithoutPeers,
                PeersResolutionResult
              >(
                importerResolutionResult,
                filterMissingPeers(
                  await resolveDependenciesResult.resolvingPeers,
                  parentPkgAliases
                )
              );
            }

            return allMissingOptionalPeers;
          }
        )
      )
    ).filter(Boolean);

    let hasNewMissingPeers = false;

    await Promise.all(
      allMissingOptionalPeersByImporters.map(
        async (
          allMissingOptionalPeers: Record<string, string[]>,
          index: number
        ): Promise<void> => {
          const importer = importers[index];

          if (typeof importer === 'undefined') {
            return;
          }

          const { preferredVersions, parentPkgAliases, options } = importer;

          if (
            Object.keys(allMissingOptionalPeers).length &&
            ctx.allPreferredVersions
          ) {
            const optionalDependencies = getHoistableOptionalPeers(
              allMissingOptionalPeers,
              ctx.allPreferredVersions
            );

            if (Object.keys(optionalDependencies).length) {
              hasNewMissingPeers = true;

              const wantedDependencies = getNonDevWantedDependencies({
                optionalDependencies,
              });

              const resolveDependenciesResult = await resolveDependencies(
                ctx,
                preferredVersions,
                wantedDependencies,
                {
                  ...options,
                  parentPkgAliases,
                  publishedBy,
                  updateToLatest: false,
                }
              );

              const pkg = pkgAddressesByImportersWithoutPeers[index];

              if (typeof pkg !== 'undefined') {
                pkg.pkgAddresses.push(
                  ...resolveDependenciesResult.pkgAddresses
                );

                Object.assign<
                  PkgAddressesByImportersWithoutPeers,
                  PeersResolutionResult
                >(
                  pkg,
                  filterMissingPeers(
                    await resolveDependenciesResult.resolvingPeers,
                    parentPkgAliases
                  )
                );
              }
            }
          }
        }
      )
    );

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!hasNewMissingPeers) {
      break;
    }
  }

  return {
    pkgAddressesByImporters: pkgAddressesByImportersWithoutPeers.map(
      ({
        pkgAddresses,
      }: PkgAddressesByImportersWithoutPeers): (
        | PkgAddress
        | LinkedDependency
      )[] => {
        return pkgAddresses;
      }
    ),
    time,
  };
}

type ResolvedDependenciesResult = {
  pkgAddresses: Array<PkgAddress | LinkedDependency>;
  resolvingPeers: Promise<PeersResolutionResult>;
};

interface PkgAddressesByImportersWithoutPeers extends PeersResolutionResult {
  pkgAddresses: Array<PkgAddress | LinkedDependency>;
}

export type ImporterToResolveOptions = Omit<
  ResolvedDependenciesOptions,
  'parentPkgAliases' | 'publishedBy'
>;

export type ImporterToResolve = {
  updatePackageManifest: boolean;
  preferredVersions: PreferredVersions;
  parentPkgAliases: ParentPkgAliases;
  wantedDependencies: Array<
    WantedDependency & { updateDepth?: number | undefined }
  >;
  options: ImporterToResolveOptions;
};

type ResolveDependenciesOfImportersResult = {
  pkgAddressesByImportersWithoutPeers: PkgAddressesByImportersWithoutPeers[];
  publishedBy?: Date | undefined;
  time?: Record<string, string> | undefined;
};

async function resolveDependenciesOfImporters(
  ctx: ResolutionContext,
  importers: ImporterToResolve[]
): Promise<ResolveDependenciesOfImportersResult> {
  const pickLowestVersion =
    ctx.resolutionMode === 'time-based' ||
    ctx.resolutionMode === 'lowest-direct';

  const resolveResults = await Promise.all(
    importers.map(
      async (
        importer: ImporterToResolve
      ): Promise<{
        pkgAddresses: PkgAddress[];
        postponedResolutionsQueue: PostponedResolutionFunction[];
        postponedPeersResolutionQueue: PostponedPeersResolutionFunction[];
      }> => {
        const extendedWantedDeps = getDepsToResolve(
          importer.wantedDependencies,
          ctx.wantedLockfile,
          {
            preferredDependencies: importer.options.preferredDependencies,
            prefix: importer.options.prefix,
            proceed: importer.options.proceed || ctx.forceFullResolution,
            registries: ctx.registries,
            resolvedDependencies: importer.options.resolvedDependencies,
          }
        );

        const postponedResolutionsQueue: PostponedResolutionFunction[] = [];

        const postponedPeersResolutionQueue: PostponedPeersResolutionFunction[] =
          [];

        const pkgAddresses: PkgAddress[] = [];

        const resolveDependenciesOfImporterWantedDep =
          resolveDependenciesOfImporterDependency.bind(null, {
            ctx,
            importer,
            pickLowestVersion,
          });

        const resolvedDependenciesOfImporter = await Promise.all(
          extendedWantedDeps.map(resolveDependenciesOfImporterWantedDep)
        );

        for (const {
          resolveDependencyResult,
          postponedPeersResolution,
          postponedResolution,
        } of resolvedDependenciesOfImporter) {
          if (resolveDependencyResult) {
            pkgAddresses.push(resolveDependencyResult as PkgAddress);
          }

          if (postponedResolution) {
            postponedResolutionsQueue.push(postponedResolution);
          }

          if (postponedPeersResolution) {
            postponedPeersResolutionQueue.push(postponedPeersResolution);
          }
        }

        return {
          pkgAddresses,
          postponedResolutionsQueue,
          postponedPeersResolutionQueue,
        };
      }
    )
  );

  let publishedBy: Date | undefined;

  let time: Record<string, string> | undefined;

  if (ctx.resolutionMode === 'time-based') {
    const result = getPublishedByDate(
      resolveResults.flatMap(({ pkgAddresses }) => pkgAddresses),
      ctx.wantedLockfile.time
    );

    if (result.publishedBy) {
      publishedBy = new Date(result.publishedBy.getTime() + 60 * 60 * 1000); // adding 1 hour delta

      time = result.newTime;
    }
  }

  const pkgAddressesByImportersWithoutPeers = await Promise.all(
    zipWith.default(
      async (
        importer,
        {
          pkgAddresses,
          postponedResolutionsQueue,
          postponedPeersResolutionQueue,
        }
      ) => {
        const newPreferredVersions: PreferredVersions = Object.create(
          importer.preferredVersions
        );

        const currentParentPkgAliases: Record<string, PkgAddress | true> = {};

        for (const pkgAddress of pkgAddresses) {
          if (currentParentPkgAliases[pkgAddress.alias] !== true) {
            currentParentPkgAliases[pkgAddress.alias] = pkgAddress;
          }

          if (pkgAddress.updated) {
            ctx.updatedSet.add(pkgAddress.alias);
          }

          const resolvedPackage = ctx.resolvedPkgsById[pkgAddress.pkgId];

          // This will happen only with linked dependencies
          if (typeof resolvedPackage === 'undefined') {
            continue;
          }

          if (
            !Object.prototype.hasOwnProperty.call(
              newPreferredVersions,
              resolvedPackage.name
            )
          ) {
            newPreferredVersions[resolvedPackage.name] = {
              ...importer.preferredVersions[resolvedPackage.name],
            };
          }

          const nv = newPreferredVersions[resolvedPackage.name];

          if (
            typeof nv !== 'undefined' &&
            typeof nv[resolvedPackage.version] === 'undefined'
          ) {
            nv[resolvedPackage.version] = {
              selectorType: 'version',
              weight: DIRECT_DEP_SELECTOR_WEIGHT,
            };
          }
        }

        const newParentPkgAliases = {
          ...importer.parentPkgAliases,
          ...currentParentPkgAliases,
        };

        const postponedResolutionOpts: PostponedResolutionOpts = {
          preferredVersions: newPreferredVersions,
          parentPkgAliases: newParentPkgAliases,
          publishedBy,
        };

        const childrenResults = await Promise.all(
          postponedResolutionsQueue.map((postponedResolution) =>
            postponedResolution(postponedResolutionOpts)
          )
        );

        if (ctx.hoistPeers !== true) {
          return {
            missingPeers: {},
            pkgAddresses,
            resolvedPeers: {},
          };
        }

        const postponedPeersResolution = await Promise.all(
          postponedPeersResolutionQueue.map(
            (postponedMissingPeers): Promise<PeersResolutionResult> => {
              return postponedMissingPeers(
                postponedResolutionOpts.parentPkgAliases
              );
            }
          )
        );

        const resolvedPeers = [
          ...childrenResults,
          ...postponedPeersResolution,
        ].reduce(
          (
            acc: ResolvedPeers,
            { resolvedPeers }: PeersResolutionResult
          ): ResolvedPeers => {
            return Object.assign<ResolvedPeers, ResolvedPeers>(
              acc,
              resolvedPeers
            );
          },
          {}
        );

        const allMissingPeers = mergePkgsDeps(
          [
            ...filterMissingPeersFromPkgAddresses(
              pkgAddresses,
              currentParentPkgAliases,
              resolvedPeers
            ),
            ...childrenResults,
            ...postponedPeersResolution,
          ]
            .map(
              ({
                missingPeers,
              }: PkgAddress | PeersResolutionResult): MissingPeers => {
                return missingPeers;
              }
            )
            .filter(Boolean),
          {
            autoInstallPeersFromHighestMatch:
              ctx.autoInstallPeersFromHighestMatch,
          }
        );

        return {
          missingPeers: allMissingPeers,
          pkgAddresses,
          resolvedPeers,
        };
      },
      importers,
      resolveResults
    )
  );

  return {
    pkgAddressesByImportersWithoutPeers,
    publishedBy,
    time,
  };
}

export type ResolveDependenciesOfImporterDependencyOpts = {
  readonly ctx: ResolutionContext;
  readonly importer: ImporterToResolve;
  readonly pickLowestVersion: boolean;
};

async function resolveDependenciesOfImporterDependency(
  {
    ctx,
    importer,
    pickLowestVersion,
  }: ResolveDependenciesOfImporterDependencyOpts,
  extendedWantedDep: ExtendedWantedDependency
): Promise<ResolveDependenciesOfDependency> {
  // The catalog protocol is only usable in importers (i.e. packages in the
  // workspace. Replacing catalog protocol while resolving importers here before
  // resolving dependencies of packages outside of the workspace/monorepo.
  const catalogLookup = matchCatalogResolveResult(
    ctx.catalogResolver(extendedWantedDep.wantedDependency),
    {
      found: (result: CatalogResolutionFound): CatalogResolution => {
        return result.resolution;
      },
      unused: (): undefined => undefined,
      misconfiguration: (result: CatalogResolutionMisconfiguration): never => {
        throw result.error;
      },
    }
  );

  const originalPref = extendedWantedDep.wantedDependency.pref;
  const originalAlias = extendedWantedDep.wantedDependency.alias;

  if (
    typeof catalogLookup !== 'undefined' &&
    typeof ctx.wantedLockfile.catalogs !== 'undefined' &&
    typeof originalAlias === 'string'
  ) {
    // The lockfile from a previous installation may have already resolved this
    // cataloged dependency. Reuse the exact version in the lockfile catalog
    // snapshot to ensure all projects using the same cataloged dependency get
    // the same version.
    const existingCatalogResolution =
      ctx.wantedLockfile.catalogs[catalogLookup.catalogName]?.[originalAlias];

    const replacementPref =
      existingCatalogResolution?.specifier === catalogLookup.specifier
        ? replaceVersionInPref(
            catalogLookup.specifier,
            existingCatalogResolution.version
          )
        : catalogLookup.specifier;

    extendedWantedDep.wantedDependency.pref = replacementPref;
  }

  const result = await resolveDependenciesOfDependency(
    ctx,
    importer.preferredVersions,
    {
      ...importer.options,
      parentPkgAliases: importer.parentPkgAliases,
      pickLowestVersion: pickLowestVersion && !importer.updatePackageManifest,
      // Cataloged dependencies cannot be upgraded yet since they require
      // updating the pnpm-workspace.yaml file. This will be handled in a future
      // version of pnpm.
      updateToLatest:
        catalogLookup != null ? false : importer.options.updateToLatest,
    },
    extendedWantedDep
  );

  // If the catalog protocol was used, store metadata about the catalog
  // lookup to use in the lockfile.
  if (result.resolveDependencyResult != null && catalogLookup != null) {
    result.resolveDependencyResult.catalogLookup = {
      ...catalogLookup,
      userSpecifiedPref: originalPref,
    };
  }

  return result;
}

function filterMissingPeersFromPkgAddresses(
  pkgAddresses: PkgAddress[],
  currentParentPkgAliases: ParentPkgAliases,
  resolvedPeers: ResolvedPeers
): PkgAddress[] {
  return pkgAddresses.map((pkgAddress: PkgAddress): PkgAddress => {
    return {
      ...pkgAddress,
      missingPeers: pickBy.default((_, peerName: string): boolean => {
        if (typeof currentParentPkgAliases[peerName] === 'undefined') {
          return true;
        }

        if (currentParentPkgAliases[peerName] !== true) {
          resolvedPeers[peerName] = currentParentPkgAliases[
            peerName
          ] as PkgAddress;
        }

        return false;
      }, pkgAddress.missingPeers),
    };
  });
}

function getPublishedByDate(
  pkgAddresses: PkgAddress[],
  timeFromLockfile: Record<string, string> = {}
): { publishedBy?: Date | undefined; newTime: Record<string, string> } {
  const newTime: Record<string, string> = {};

  for (const pkgAddress of pkgAddresses) {
    const tf = timeFromLockfile[pkgAddress.pkgId];

    if (typeof pkgAddress.publishedAt === 'string') {
      newTime[pkgAddress.pkgId] = pkgAddress.publishedAt;
    } else if (typeof tf !== 'undefined') {
      newTime[pkgAddress.pkgId] = tf;
    }
  }

  const sortedDates = Object.values(newTime)
    .map((publishedAt: string): Date => {
      return new Date(publishedAt);
    })
    .sort((d1: Date, d2: Date): number => {
      return d1.getTime() - d2.getTime();
    });

  return { publishedBy: sortedDates[sortedDates.length - 1], newTime };
}

export async function resolveDependencies(
  ctx: ResolutionContext,
  preferredVersions: PreferredVersions,
  wantedDependencies: Array<
    WantedDependency & { updateDepth?: number | undefined }
  >,
  options: ResolvedDependenciesOptions
): Promise<ResolvedDependenciesResult> {
  const extendedWantedDeps = getDepsToResolve(
    wantedDependencies,
    ctx.wantedLockfile,
    {
      preferredDependencies: options.preferredDependencies,
      prefix: options.prefix,
      proceed: options.proceed || ctx.forceFullResolution,
      registries: ctx.registries,
      resolvedDependencies: options.resolvedDependencies,
    }
  );

  const postponedResolutionsQueue: PostponedResolutionFunction[] = [];

  const postponedPeersResolutionQueue: PostponedPeersResolutionFunction[] = [];

  const pkgAddresses: PkgAddress[] = [];

  await Promise.all(
    extendedWantedDeps.map(
      async (extendedWantedDep: ExtendedWantedDependency): Promise<void> => {
        const {
          resolveDependencyResult,
          postponedResolution,
          postponedPeersResolution,
        } = await resolveDependenciesOfDependency(
          ctx,
          preferredVersions,
          options,
          extendedWantedDep
        );

        if (resolveDependencyResult) {
          pkgAddresses.push(resolveDependencyResult as PkgAddress);
        }

        if (postponedResolution) {
          postponedResolutionsQueue.push(postponedResolution);
        }

        if (postponedPeersResolution) {
          postponedPeersResolutionQueue.push(postponedPeersResolution);
        }
      }
    )
  );

  const newPreferredVersions = Object.create(
    preferredVersions
  ) as PreferredVersions;

  const currentParentPkgAliases: Record<string, PkgAddress | true> = {};

  for (const pkgAddress of pkgAddresses) {
    if (currentParentPkgAliases[pkgAddress.alias] !== true) {
      currentParentPkgAliases[pkgAddress.alias] = pkgAddress;
    }

    if (pkgAddress.updated) {
      ctx.updatedSet.add(pkgAddress.alias);
    }

    const resolvedPackage = ctx.resolvedPkgsById[pkgAddress.pkgId];

    // This will happen only with linked dependencies
    if (!resolvedPackage) {
      continue;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        newPreferredVersions,
        resolvedPackage.name
      )
    ) {
      newPreferredVersions[resolvedPackage.name] = {
        ...preferredVersions[resolvedPackage.name],
      };
    }

    const nv = newPreferredVersions[resolvedPackage.name];

    if (
      typeof nv !== 'undefined' &&
      typeof nv[resolvedPackage.version] === 'undefined'
    ) {
      nv[resolvedPackage.version] = 'version';
    }
  }

  const newParentPkgAliases = {
    ...options.parentPkgAliases,
    ...currentParentPkgAliases,
  };

  const postponedResolutionOpts: PostponedResolutionOpts = {
    preferredVersions: newPreferredVersions,
    parentPkgAliases: newParentPkgAliases,
    publishedBy: options.publishedBy,
  };

  const childrenResults = await Promise.all(
    postponedResolutionsQueue.map(
      (postponedResolution): Promise<PeersResolutionResult> => {
        return postponedResolution(postponedResolutionOpts);
      }
    )
  );

  if (ctx.hoistPeers !== true) {
    return {
      resolvingPeers: Promise.resolve({
        missingPeers: {},
        resolvedPeers: {},
      }),
      pkgAddresses,
    };
  }

  return {
    pkgAddresses,
    resolvingPeers: startResolvingPeers({
      childrenResults,
      pkgAddresses,
      parentPkgAliases: options.parentPkgAliases,
      currentParentPkgAliases,
      postponedPeersResolutionQueue,
      autoInstallPeersFromHighestMatch: ctx.autoInstallPeersFromHighestMatch,
    }),
  };
}

async function startResolvingPeers({
  childrenResults,
  currentParentPkgAliases,
  parentPkgAliases,
  pkgAddresses,
  postponedPeersResolutionQueue,
  autoInstallPeersFromHighestMatch,
}: {
  childrenResults: PeersResolutionResult[];
  currentParentPkgAliases: ParentPkgAliases;
  parentPkgAliases: ParentPkgAliases;
  pkgAddresses: PkgAddress[];
  postponedPeersResolutionQueue: PostponedPeersResolutionFunction[];
  autoInstallPeersFromHighestMatch: boolean;
}): Promise<PeersResolutionResult> {
  const results = await Promise.all(
    postponedPeersResolutionQueue.map(
      (postponedPeersResolution): Promise<PeersResolutionResult> => {
        return postponedPeersResolution(parentPkgAliases);
      }
    )
  );

  const resolvedPeers = [...childrenResults, ...results].reduce(
    (
      acc: ResolvedPeers,
      { resolvedPeers }: PeersResolutionResult
    ): ResolvedPeers => {
      return Object.assign<ResolvedPeers, ResolvedPeers>(acc, resolvedPeers);
    },
    {}
  );

  const allMissingPeers = mergePkgsDeps(
    [
      ...filterMissingPeersFromPkgAddresses(
        pkgAddresses,
        currentParentPkgAliases,
        resolvedPeers
      ),
      ...childrenResults,
      ...results,
    ]
      .map(
        ({
          missingPeers,
        }:
          | PkgAddress
          | PeersResolutionResult
          | PeersResolutionResult): MissingPeers => {
          return missingPeers;
        }
      )
      .filter(Boolean),
    { autoInstallPeersFromHighestMatch }
  );

  return {
    missingPeers: allMissingPeers,
    resolvedPeers,
  };
}

function mergePkgsDeps(
  pkgsDeps: MissingPeers[],
  opts: { autoInstallPeersFromHighestMatch: boolean }
): MissingPeers {
  const groupedRanges: Record<string, { ranges: string[]; optional: boolean }> =
    {};

  for (const deps of pkgsDeps) {
    for (const [name, { range, optional }] of Object.entries(deps)) {
      if (typeof groupedRanges[name] === 'undefined') {
        groupedRanges[name] = { ranges: [], optional };
      } else {
        groupedRanges[name].optional &&= optional;
      }

      groupedRanges[name].ranges.push(range);
    }
  }

  const mergedPkgDeps = {} as MissingPeers;

  for (const [name, { ranges, optional }] of Object.entries(groupedRanges)) {
    const intersection = safeIntersect(ranges);

    if (intersection !== null) {
      mergedPkgDeps[name] = { range: intersection, optional };
    } else if (opts.autoInstallPeersFromHighestMatch) {
      mergedPkgDeps[name] = { range: ranges.join(' || '), optional };
    }
  }

  return mergedPkgDeps;
}

type ExtendedWantedDependency = {
  infoFromLockfile?: InfoFromLockfile | undefined;
  proceed: boolean;
  wantedDependency: WantedDependency & { updateDepth?: number | undefined };
};

type ResolveDependenciesOfDependency = {
  postponedResolution?: PostponedResolutionFunction | undefined;
  postponedPeersResolution?: PostponedPeersResolutionFunction | undefined;
  resolveDependencyResult: ResolveDependencyResult;
};

async function resolveDependenciesOfDependency(
  ctx: ResolutionContext,
  preferredVersions: PreferredVersions,
  options: ResolvedDependenciesOptions,
  extendedWantedDep: ExtendedWantedDependency
): Promise<ResolveDependenciesOfDependency> {
  const updateDepth =
    typeof extendedWantedDep.wantedDependency.updateDepth === 'number'
      ? extendedWantedDep.wantedDependency.updateDepth
      : options.updateDepth;

  const updateShouldContinue = options.currentDepth <= updateDepth;

  const update =
    typeof extendedWantedDep.infoFromLockfile?.name === 'string' &&
    (typeof extendedWantedDep.infoFromLockfile.dependencyLockfile ===
      'undefined' ||
      (updateShouldContinue &&
        (typeof options.updateMatching === 'undefined' ||
          options.updateMatching(extendedWantedDep.infoFromLockfile.name))) ||
      Boolean(
        ctx.workspacePackages != null &&
          ctx.linkWorkspacePackagesDepth !== -1 &&
          wantedDepIsLocallyAvailable(
            ctx.workspacePackages,
            extendedWantedDep.wantedDependency,
            { defaultTag: ctx.defaultTag, registry: ctx.registries.default }
          )
      ) ||
      ctx.updatedSet.has(extendedWantedDep.infoFromLockfile.name));

  const resolveDependencyOpts: ResolveDependencyOptions = {
    currentDepth: options.currentDepth,
    parentPkg: options.parentPkg,
    parentPkgAliases: options.parentPkgAliases,
    preferredVersions,
    currentPkg: extendedWantedDep.infoFromLockfile ?? undefined,
    pickLowestVersion: options.pickLowestVersion,
    prefix: options.prefix,
    proceed:
      extendedWantedDep.proceed ||
      updateShouldContinue ||
      ctx.updatedSet.size > 0,
    publishedBy: options.publishedBy,
    update: update
      ? options.updateToLatest === true
        ? 'latest'
        : 'compatible'
      : false,
    updateDepth,
    updateMatching: options.updateMatching,
    supportedArchitectures: options.supportedArchitectures,
    parentIds: options.parentIds,
  };

  const resolveDependencyResult = await resolveDependency(
    extendedWantedDep.wantedDependency,
    ctx,
    resolveDependencyOpts
  );

  if (resolveDependencyResult == null) {
    return { resolveDependencyResult: null };
  }

  if (resolveDependencyResult.isLinkedDependency) {
    ctx.dependenciesTree.set(
      createNodeIdForLinkedLocalPkg(
        ctx.lockfileDir,
        resolveDependencyResult.resolution.directory
      ),
      {
        children: {},
        depth: -1,
        installable: true,
        resolvedPackage: {
          name: resolveDependencyResult.name,
          version: resolveDependencyResult.version,
        },
      }
    );

    return { resolveDependencyResult };
  }

  if (resolveDependencyResult.isNew !== true) {
    const mc = resolveDependencyResult.missingPeersOfChildren;

    return {
      resolveDependencyResult,
      postponedPeersResolution:
        typeof mc === 'undefined'
          ? undefined
          : async (
              parentPkgAliases: ParentPkgAliases
            ): Promise<PeersResolutionResult> => {
              const missingPeers = await mc.get();

              return filterMissingPeers(
                { missingPeers, resolvedPeers: {} },
                parentPkgAliases
              );
            },
    };
  }

  const postponedResolution = resolveChildren.bind(null, ctx, {
    parentPkg: resolveDependencyResult,
    dependencyLockfile: extendedWantedDep.infoFromLockfile?.dependencyLockfile,
    parentDepth: options.currentDepth,
    parentIds: [...options.parentIds, resolveDependencyResult.pkgId],
    updateDepth,
    prefix: options.prefix,
    updateMatching: options.updateMatching,
    supportedArchitectures: options.supportedArchitectures,
    updateToLatest: options.updateToLatest,
  });

  return {
    resolveDependencyResult,
    postponedResolution: async (
      postponedResolutionOpts: PostponedResolutionOpts
    ): Promise<PeersResolutionResult> => {
      const { missingPeers, resolvedPeers } = await postponedResolution(
        postponedResolutionOpts
      );

      if (resolveDependencyResult.missingPeersOfChildren) {
        resolveDependencyResult.missingPeersOfChildren.resolved = true;

        resolveDependencyResult.missingPeersOfChildren.resolve(missingPeers);
      }

      return filterMissingPeers(
        { missingPeers, resolvedPeers },
        postponedResolutionOpts.parentPkgAliases
      );
    },
  };
}

export function createNodeIdForLinkedLocalPkg(
  lockfileDir: string,
  pkgDir: string
): NodeId {
  return `link:${normalizePath(path.relative(lockfileDir, pkgDir))}` as NodeId;
}

function filterMissingPeers(
  { missingPeers, resolvedPeers }: PeersResolutionResult,
  parentPkgAliases: ParentPkgAliases
): PeersResolutionResult {
  const newMissing: MissingPeers = {};

  for (const [peerName, peerVersion] of Object.entries(missingPeers)) {
    if (typeof parentPkgAliases[peerName] === 'undefined') {
      newMissing[peerName] = peerVersion;
    } else if (parentPkgAliases[peerName] !== true) {
      resolvedPeers[peerName] = parentPkgAliases[peerName]; // as PkgAddress;
    }
  }

  return {
    resolvedPeers,
    missingPeers: newMissing,
  };
}

async function resolveChildren(
  ctx: ResolutionContext,
  {
    parentPkg,
    parentIds,
    dependencyLockfile,
    parentDepth,
    updateDepth,
    updateMatching,
    prefix,
    supportedArchitectures,
  }: {
    parentPkg: PkgAddress;
    parentIds: PkgResolutionId[];
    dependencyLockfile: PackageSnapshot | undefined;
    parentDepth: number;
    updateDepth: number;
    prefix: string;
    updateMatching?: UpdateMatchingFunction | undefined;
    supportedArchitectures?: SupportedArchitectures | undefined;
    updateToLatest?: boolean | undefined;
  },
  {
    parentPkgAliases,
    preferredVersions,
    publishedBy,
  }: {
    parentPkgAliases: ParentPkgAliases;
    preferredVersions: PreferredVersions;
    publishedBy?: Date | undefined;
  }
): Promise<PeersResolutionResult> {
  const currentResolvedDependencies =
    dependencyLockfile != null
      ? {
          ...dependencyLockfile.dependencies,
          ...dependencyLockfile.optionalDependencies,
        }
      : undefined;

  const resolvedDependencies = parentPkg.updated
    ? undefined
    : currentResolvedDependencies;

  const parentDependsOnPeer = Boolean(
    Object.keys(
      dependencyLockfile?.peerDependencies ??
        parentPkg.pkg.peerDependencies ??
        {}
    ).length
  );

  const wantedDependencies = getNonDevWantedDependencies(parentPkg.pkg);

  const { pkgAddresses, resolvingPeers } = await resolveDependencies(
    ctx,
    preferredVersions,
    wantedDependencies,
    {
      currentDepth: parentDepth + 1,
      parentPkg,
      parentPkgAliases,
      preferredDependencies: currentResolvedDependencies,
      prefix,
      // If the package is not linked, we should also gather information about its dependencies.
      // After linking the package we'll need to symlink its dependencies.
      proceed: !parentPkg.depIsLinked || parentDependsOnPeer,
      publishedBy,
      resolvedDependencies,
      updateDepth,
      updateMatching,
      supportedArchitectures,
      parentIds,
    }
  );

  ctx.childrenByParentId[parentPkg.pkgId] = pkgAddresses.map((child) => ({
    alias: child.alias,
    id: child.pkgId,
  }));

  const resolvedPackage = ctx.resolvedPkgsById[parentPkg.pkgId];

  if (typeof resolvedPackage !== 'undefined') {
    ctx.dependenciesTree.set(parentPkg.nodeId, {
      children: pkgAddresses.reduce(
        (
          chn: Record<string, NodeId>,
          child: PkgAddress | LinkedDependency
        ): Record<string, NodeId> => {
          // PkgAddress
          chn[child.alias] =
            'nodeId' in child
              ? child.nodeId
              : (child.pkgId as unknown as NodeId);

          return chn;
        },
        {}
      ),
      depth: parentDepth,
      installable: parentPkg.installable,
      resolvedPackage,
    });
  }

  return resolvingPeers;
}

function getDepsToResolve(
  wantedDependencies: Array<
    WantedDependency & { updateDepth?: number | undefined }
  >,
  wantedLockfile: LockfileObject,
  options: {
    preferredDependencies?: ResolvedDependencies | undefined;
    prefix: string;
    proceed: boolean;
    registries: Registries;
    resolvedDependencies?: ResolvedDependencies | undefined;
  }
): ExtendedWantedDependency[] {
  const resolvedDependencies = options.resolvedDependencies ?? {};

  const preferredDependencies = options.preferredDependencies ?? {};

  const extendedWantedDeps: ExtendedWantedDependency[] = [];

  // The only reason we resolve children in case the package depends on peers
  // is to get information about the existing dependencies, so that they can
  // be merged with the resolved peers.
  let proceedAll = options.proceed;

  const satisfiesWanted2Args = referenceSatisfiesWantedSpec.bind(null, {
    lockfile: wantedLockfile,
    prefix: options.prefix,
  });

  for (const wantedDependency of wantedDependencies) {
    let reference = undefined as undefined | string;

    let proceed = proceedAll;

    if (
      typeof wantedDependency.alias === 'string' &&
      typeof wantedDependency.pref === 'string'
    ) {
      const satisfiesWanted = satisfiesWanted2Args.bind(null, {
        alias: wantedDependency.alias,
        pref: wantedDependency.pref,
      });

      const rd = resolvedDependencies[wantedDependency.alias];

      const pd = preferredDependencies[wantedDependency.alias];

      if (
        typeof rd === 'string' &&
        (satisfiesWanted(rd) || rd.startsWith('file:'))
      ) {
        reference = rd;
      } else if (
        // If dependencies that were used by the previous version of the package
        // satisfy the newer version's requirements, then pnpm tries to keep
        // the previous dependency.
        // So for example, if foo@1.0.0 had bar@1.0.0 as a dependency
        // and foo was updated to 1.1.0 which depends on bar ^1.0.0
        // then bar@1.0.0 can be reused for foo@1.1.0
        semver.validRange(wantedDependency.pref) !== null &&
        typeof pd === 'string' &&
        satisfiesWanted(pd)
      ) {
        proceed = true;

        reference = pd;
      }
    }

    const infoFromLockfile = getInfoFromLockfile(
      wantedLockfile,
      options.registries,
      reference,
      wantedDependency.alias
    );
    if (
      !proceedAll &&
      (infoFromLockfile == null ||
        (infoFromLockfile.dependencyLockfile != null &&
          (typeof infoFromLockfile.dependencyLockfile.peerDependencies !==
            'undefined' ||
            (typeof infoFromLockfile.dependencyLockfile
              .transitivePeerDependencies !== 'undefined' &&
              infoFromLockfile.dependencyLockfile.transitivePeerDependencies
                .length > 0))))
    ) {
      proceed = true;

      proceedAll = true;

      for (const extendedWantedDep of extendedWantedDeps) {
        if (!extendedWantedDep.proceed) {
          extendedWantedDep.proceed = true;
        }
      }
    }

    extendedWantedDeps.push({
      infoFromLockfile,
      proceed,
      wantedDependency,
    });
  }

  return extendedWantedDeps;
}

function referenceSatisfiesWantedSpec(
  opts: {
    lockfile: LockfileObject;
    prefix: string;
  },
  wantedDep: { alias: string; pref: string },
  preferredRef: string
): boolean {
  const depPath = dp.refToRelative(preferredRef, wantedDep.alias);

  if (depPath === null) {
    return false;
  }

  const pkgSnapshot = opts.lockfile.packages?.[depPath];

  if (pkgSnapshot == null) {
    logger.warn({
      message: `Could not find preferred package ${depPath} in lockfile`,
      prefix: opts.prefix,
    });

    return false;
  }

  const { version } = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

  if (
    semver.validRange(wantedDep.pref) === null &&
    Object.values(opts.lockfile.importers ?? {}).filter(
      (importer: ProjectSnapshot): boolean => {
        return importer.specifiers[wantedDep.alias] === wantedDep.pref;
      }
    ).length
  ) {
    return true;
  }

  return semver.satisfies(version, wantedDep.pref, true);
}

type InfoFromLockfile = {
  pkgId: PkgResolutionId;
  dependencyLockfile?: PackageSnapshot | undefined;
  name?: string | undefined;
  version?: string | undefined;
  resolution?: Resolution | undefined;
} & (
  | {
      dependencyLockfile: PackageSnapshot;
      name: string;
      version: string;
      resolution: Resolution;
    }
  | unknown
);

function getInfoFromLockfile(
  lockfile: LockfileObject,
  registries: Registries,
  reference: string | undefined,
  alias: string | undefined
): InfoFromLockfile | undefined {
  if (
    typeof reference === 'undefined' ||
    reference === '' ||
    typeof alias === 'undefined' ||
    alias === ''
  ) {
    return undefined;
  }

  const depPath = dp.refToRelative(reference, alias);

  if (!depPath) {
    return undefined;
  }

  let dependencyLockfile = lockfile.packages?.[depPath];

  if (dependencyLockfile != null) {
    if (
      dependencyLockfile.peerDependencies != null &&
      dependencyLockfile.dependencies != null
    ) {
      // This is done to guarantee that the dependency will be relinked with the
      // up-to-date peer dependencies
      // Covered by test: "peer dependency is grouped with dependency when peer is resolved not from a top dependency"
      const dependencies: Record<string, string> = {};

      for (const [depName, ref] of Object.entries(
        dependencyLockfile.dependencies ?? {}
      )) {
        if (
          typeof dependencyLockfile.peerDependencies[depName] !== 'undefined'
        ) {
          continue;
        }

        dependencies[depName] = ref;
      }

      dependencyLockfile = {
        ...dependencyLockfile,
        dependencies,
      };
    }

    const { name, version, nonSemverVersion } = nameVerFromPkgSnapshot(
      depPath,
      dependencyLockfile
    );
    return {
      name,
      version,
      dependencyLockfile,
      pkgId: nonSemverVersion ?? (`${name}@${version}` as PkgResolutionId),
      // resolution may not exist if lockfile is broken, and an unexpected error will be thrown
      // if resolution does not exist, return undefined so it can be autofixed later
      resolution:
        dependencyLockfile.resolution &&
        pkgSnapshotToResolution(depPath, dependencyLockfile, registries),
    };
  }

  const parsed = dp.parse(depPath);

  return {
    pkgId:
      parsed.nonSemverVersion ??
      ((typeof parsed.name === 'string' && typeof parsed.version === 'string'
        ? `${parsed.name}@${parsed.version}`
        : depPath) as PkgResolutionId), // Does it make sense to set pkgId when we're not sure?
  };
}

interface ResolveDependencyOptions {
  currentDepth: number;
  currentPkg?:
    | {
        depPath?: DepPath | undefined;
        name?: string | undefined;
        version?: string | undefined;
        pkgId?: PkgResolutionId | undefined;
        resolution?: Resolution | undefined;
        dependencyLockfile?: PackageSnapshot | undefined;
      }
    | undefined;
  parentPkg: ParentPkg;
  parentIds: PkgResolutionId[];
  parentPkgAliases: ParentPkgAliases;
  preferredVersions: PreferredVersions;
  prefix: string;
  proceed: boolean;
  publishedBy?: Date | undefined;
  pickLowestVersion?: boolean | undefined;
  update: false | 'compatible' | 'latest';
  updateDepth: number;
  updateMatching?: UpdateMatchingFunction | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
}

type ResolveDependencyResult = PkgAddress | LinkedDependency | null;

async function resolveDependency(
  wantedDependency: WantedDependency,
  ctx: ResolutionContext,
  options: ResolveDependencyOptions
): Promise<ResolveDependencyResult> {
  const currentPkg = options.currentPkg;

  const currentLockfileContainsTheDep = currentPkg?.depPath
    ? Boolean(ctx.currentLockfile.packages?.[currentPkg.depPath])
    : undefined;

  const depIsLinked = Boolean(
    // if package is not in `node_modules/.pnpm-lock.yaml`
    // we can safely assume that it doesn't exist in `node_modules`
    currentLockfileContainsTheDep === true &&
      currentPkg?.depPath &&
      currentPkg.dependencyLockfile &&
      typeof currentPkg.name === 'string' &&
      (await pathExists(
        path.join(
          ctx.virtualStoreDir,
          dp.depPathToFilename(
            currentPkg.depPath,
            ctx.virtualStoreDirMaxLength
          ),
          'node_modules',
          currentPkg.name,
          'package.json'
        )
      ))
  );

  if (
    options.update === false &&
    !options.proceed &&
    typeof currentPkg?.resolution !== 'undefined' &&
    depIsLinked
  ) {
    return null;
  }

  let pkgResponse: PackageResponse | undefined;

  let newWantedDependency: WantedDependency = wantedDependency;

  if (options.parentPkg.installable !== true) {
    newWantedDependency = {
      ...newWantedDependency,
      optional: true,
    };
  }

  try {
    if (
      options.update === false &&
      typeof currentPkg?.pkgId === 'string' &&
      typeof currentPkg.version === 'string' &&
      typeof newWantedDependency.pref === 'string' &&
      currentPkg.pkgId.endsWith(`@${currentPkg.version}`) === true
    ) {
      newWantedDependency.pref = replaceVersionInPref(
        newWantedDependency.pref,
        currentPkg.version
      );
    }

    pkgResponse = await ctx.storeController.requestPackage(
      newWantedDependency,
      {
        alwaysTryWorkspacePackages:
          ctx.linkWorkspacePackagesDepth >= options.currentDepth,
        currentPkg: currentPkg
          ? {
              id: currentPkg.pkgId,
              resolution: currentPkg.resolution,
            }
          : undefined,
        expectedPkg: currentPkg,
        defaultTag: ctx.defaultTag,
        ignoreScripts: ctx.ignoreScripts,
        publishedBy: options.publishedBy,
        pickLowestVersion: options.pickLowestVersion,
        downloadPriority: -options.currentDepth,
        lockfileDir: ctx.lockfileDir,
        preferredVersions: options.preferredVersions,
        preferWorkspacePackages: ctx.preferWorkspacePackages,
        projectDir:
          options.currentDepth > 0 &&
          newWantedDependency.pref?.startsWith('file:') !== true
            ? ctx.lockfileDir
            : options.parentPkg.rootDir,
        registry:
          (typeof newWantedDependency.alias === 'string' &&
            pickRegistryForPackage(
              ctx.registries,
              newWantedDependency.alias,
              newWantedDependency.pref
            )) ||
          ctx.registries.default,
        skipFetch: ctx.dryRun,
        update: options.update,
        workspacePackages: ctx.workspacePackages,
        supportedArchitectures: options.supportedArchitectures,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onFetchError: (err: any): any => {
          err.prefix = options.prefix;

          err.pkgsStack = getPkgsInfoFromIds(
            options.parentIds,
            ctx.resolvedPkgsById
          );

          return err;
        },
        injectWorkspacePackages: ctx.injectWorkspacePackages,
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const wantedDependencyDetails = {
      name: newWantedDependency.alias,
      pref: newWantedDependency.pref,
      version:
        typeof newWantedDependency.alias === 'string'
          ? newWantedDependency.pref
          : undefined,
    };

    if (newWantedDependency.optional === true) {
      skippedOptionalDependencyLogger.debug({
        details: err.toString(),
        package: wantedDependencyDetails,
        parents: getPkgsInfoFromIds(options.parentIds, ctx.resolvedPkgsById),
        prefix: options.prefix,
        reason: 'resolution_failure',
      });

      return null;
    }

    err.package = wantedDependencyDetails;

    err.prefix = options.prefix;

    err.pkgsStack = getPkgsInfoFromIds(options.parentIds, ctx.resolvedPkgsById);

    throw err;
  }

  if (typeof pkgResponse.body === 'undefined') {
    throw new Error('pkgResponse.body is undefined');
  }

  dependencyResolvedLogger.debug({
    resolution: pkgResponse.body.id,
    wanted: {
      dependentId: options.parentPkg.pkgId,
      name: newWantedDependency.alias,
      rawSpec: newWantedDependency.pref,
    },
  });

  const mf = pkgResponse.body.manifest;

  if (typeof mf !== 'undefined') {
    const pvs = ctx.allPreferredVersions;

    if (typeof pvs !== 'undefined' && typeof mf.version === 'string') {
      const pv = pvs[mf.name];

      if (typeof pv === 'undefined') {
        pvs[mf.name] = {};
      } else {
        pv[mf.version] = 'version';
      }
    }
  }

  if (
    pkgResponse.body.updated !== true &&
    options.currentDepth === Math.max(0, options.updateDepth) &&
    depIsLinked &&
    !ctx.force &&
    !options.proceed
  ) {
    return null;
  }

  if (pkgResponse.body.isLocal === true) {
    if (typeof pkgResponse.body.manifest === 'undefined') {
      // This should actually never happen because the local-resolver returns a manifest
      // even if no real manifest exists in the filesystem.
      throw new PnpmError(
        'MISSING_PACKAGE_JSON',
        `Can't install ${newWantedDependency.pref}: Missing package.json file`
      );
    }

    return {
      alias:
        (newWantedDependency.alias ?? pkgResponse.body.manifest.name) ||
        path.basename(pkgResponse.body.resolution.directory),
      dev: newWantedDependency.dev ?? false,
      isLinkedDependency: true,
      name: pkgResponse.body.manifest.name,
      normalizedPref: pkgResponse.body.normalizedPref,
      optional: newWantedDependency.optional ?? false,
      pkgId: pkgResponse.body.id,
      resolution: pkgResponse.body.resolution,
      version: pkgResponse.body.manifest.version,
    };
  }

  let prepare = false;

  let hasBin = false;

  let pkg: PackageManifest | undefined = getManifestFromResponse(
    pkgResponse,
    newWantedDependency
  );

  if (!pkg.dependencies) {
    pkg.dependencies = {};
  }

  if (ctx.readPackageHook != null) {
    pkg = await ctx.readPackageHook(pkg);
  }

  if (pkg.peerDependencies && pkg.dependencies) {
    pkg = ctx.autoInstallPeers
      ? {
          ...pkg,
          dependencies: omit.default(
            Object.keys(pkg.peerDependencies),
            pkg.dependencies
          ),
        }
      : {
          ...pkg,
          dependencies: omit.default(
            Object.keys(pkg.peerDependencies).filter(
              (peerDep: string): boolean => {
                return typeof options.parentPkgAliases[peerDep] !== 'undefined';
              }
            ),
            pkg.dependencies
          ),
        };
  }

  if (!pkg.name) {
    // TODO: don't fail on optional dependencies
    throw new PnpmError(
      'MISSING_PACKAGE_NAME',
      `Can't install ${newWantedDependency.pref}: Missing package name`
    );
  }

  let pkgIdWithPatchHash: PkgIdWithPatchHash = (
    pkgResponse.body.id.startsWith(`${pkg.name}@`)
      ? pkgResponse.body.id
      : `${pkg.name}@${pkgResponse.body.id}`
  ) as PkgIdWithPatchHash;

  const patch = getPatchInfo(ctx.patchedDependencies, pkg.name, pkg.version);

  if (patch) {
    ctx.appliedPatches.add(patch.key);

    pkgIdWithPatchHash =
      `${pkgIdWithPatchHash}(patch_hash=${patch.file.hash})` as PkgIdWithPatchHash;
  }

  // We are building the dependency tree only until there are new packages
  // or the packages repeat in a unique order.
  // This is needed later during peer dependencies resolution.
  //
  // So we resolve foo > bar > qar > foo
  // But we stop on foo > bar > qar > foo > qar
  // In the second example, there's no reason to walk qar again
  // when qar is included the first time, the dependencies of foo
  // are already resolved and included as parent dependencies of qar.
  // So during peers resolution, qar cannot possibly get any new or different
  // peers resolved, after the first occurrence.
  //
  // However, in the next example we would analyze the second qar as well,
  // because zoo is a new parent package:
  // foo > bar > qar > zoo > qar
  if (
    parentIdsContainSequence(
      options.parentIds,
      options.parentPkg.pkgId,
      pkgResponse.body.id
    ) ||
    pkgResponse.body.id === options.parentPkg.pkgId
  ) {
    return null;
  }

  if (
    options.update === false &&
    typeof currentPkg?.dependencyLockfile !== 'undefined' &&
    typeof currentPkg.depPath !== 'undefined' &&
    pkgResponse.body.updated !== true &&
    // peerDependencies field is also used for transitive peer dependencies which should not be linked
    // That's why we cannot omit reading package.json of such dependencies.
    // This can be removed if we implement something like peerDependenciesMeta.transitive: true
    typeof currentPkg.dependencyLockfile.peerDependencies === 'undefined'
  ) {
    hasBin = currentPkg.dependencyLockfile.hasBin === true;

    pkg = {
      ...nameVerFromPkgSnapshot(
        currentPkg.depPath,
        currentPkg.dependencyLockfile
      ),
      ...omitDepsFields(currentPkg.dependencyLockfile),
      ...pkg,
    };
  } else {
    prepare = Boolean(
      pkgResponse.body.resolvedVia === 'git-repository' &&
        typeof pkg.scripts?.prepare === 'string'
    );

    if (
      typeof currentPkg?.dependencyLockfile?.deprecated !== 'undefined' &&
      !pkgResponse.body.updated &&
      typeof pkg.deprecated === 'undefined'
    ) {
      pkg.deprecated = currentPkg.dependencyLockfile.deprecated;
    }

    hasBin = Boolean(
      (typeof pkg.bin !== 'undefined' &&
        !(pkg.bin === '' || Object.keys(pkg.bin).length === 0)) ||
        pkg.directories?.bin
    );
  }

  if (
    options.currentDepth === 0 &&
    typeof pkgResponse.body.latest !== 'undefined' &&
    pkgResponse.body.latest !== pkg.version
  ) {
    ctx.outdatedDependencies[pkgResponse.body.id] = pkgResponse.body.latest;
  }

  if (typeof pkg.peerDependencies !== 'undefined') {
    for (const name in pkg.peerDependencies) {
      ctx.allPeerDepNames.add(name);
    }
  }

  if (typeof pkg.peerDependenciesMeta !== 'undefined') {
    for (const name in pkg.peerDependenciesMeta) {
      ctx.allPeerDepNames.add(name);
    }
  }

  // In case of leaf dependencies (dependencies that have no prod deps or peer deps),
  // we only ever need to analyze one leaf dep in a graph, so the nodeId can be short and stateless.
  const nodeId = pkgIsLeaf(pkg)
    ? (pkgResponse.body.id as unknown as NodeId)
    : nextNodeId();

  const parentIsInstallable =
    typeof options.parentPkg.installable === 'undefined' ||
    options.parentPkg.installable;

  const installable =
    parentIsInstallable && pkgResponse.body.isInstallable !== false;

  const isNew = !ctx.resolvedPkgsById[pkgResponse.body.id];

  const parentImporterId = options.parentIds[0];

  if (typeof parentImporterId === 'undefined') {
    throw new Error('parentImporterId is undefined');
  }

  const currentIsOptional =
    newWantedDependency.optional ?? options.parentPkg.optional;

  if (isNew) {
    const v = ctx.allowedDeprecatedVersions[pkg.name];

    if (
      typeof pkg.deprecated === 'string' &&
      (typeof v === 'undefined' || !semver.satisfies(pkg.version, v))
    ) {
      // Report deprecated packages only on first occurrence.
      deprecationLogger.debug({
        deprecated: pkg.deprecated,
        depth: options.currentDepth,
        pkgId: pkgResponse.body.id,
        pkgName: pkg.name,
        pkgVersion: pkg.version,
        prefix: options.prefix,
      });
    }

    if (pkgResponse.body.isInstallable === false || !parentIsInstallable) {
      ctx.skipped.add(pkgResponse.body.id);
    }

    progressLogger.debug({
      packageId: pkgResponse.body.id,
      requester: ctx.lockfileDir,
      status: 'resolved',
    });

    // WARN: It is very important to keep this sync
    // Otherwise, deprecation messages for the same package might get written several times
    ctx.resolvedPkgsById[pkgResponse.body.id] = getResolvedPackage({
      dependencyLockfile: currentPkg?.dependencyLockfile,
      pkgIdWithPatchHash,
      force: ctx.force,
      hasBin,
      patch,
      pkg,
      pkgResponse,
      prepare,
      wantedDependency: newWantedDependency,
      parentImporterId,
      optional: currentIsOptional,
    });
  } else {
    const rp = ctx.resolvedPkgsById[pkgResponse.body.id];

    if (typeof rp === 'undefined') {
      throw new Error('resolvedPkgsById is undefined');
    }

    rp.prod =
      rp.prod ||
      (newWantedDependency.dev !== true &&
        newWantedDependency.optional !== true);

    rp.dev = rp.dev ?? newWantedDependency.dev;

    rp.optional = rp.optional && currentIsOptional;

    if (
      typeof rp.fetching === 'undefined' &&
      typeof pkgResponse.fetching !== 'undefined'
    ) {
      rp.fetching = pkgResponse.fetching;

      if (typeof pkgResponse.filesIndexFile !== 'undefined') {
        rp.filesIndexFile = pkgResponse.filesIndexFile;
      }
    }

    if (ctx.dependenciesTree.has(nodeId)) {
      const n = ctx.dependenciesTree.get(nodeId);

      if (typeof n !== 'undefined') {
        n.depth = Math.min(n.depth, options.currentDepth);
      }
    } else {
      ctx.pendingNodes.push({
        alias: newWantedDependency.alias ?? pkg.name,
        depth: options.currentDepth,
        parentIds: options.parentIds,
        installable,
        nodeId,
        resolvedPackage: rp,
      });
    }
  }

  const rootDir =
    typeof pkgResponse.body.resolution !== 'undefined' &&
    'type' in pkgResponse.body.resolution &&
    pkgResponse.body.resolution.type === 'directory'
      ? (path.resolve(
          ctx.lockfileDir,
          (pkgResponse.body.resolution as DirectoryResolution).directory
        ) as ProjectRootDir)
      : (options.prefix as ProjectRootDir);

  let missingPeersOfChildren!: MissingPeersOfChildren | undefined;

  if (
    ctx.hoistPeers === true &&
    !options.parentIds.includes(pkgResponse.body.id)
  ) {
    if (ctx.missingPeersOfChildrenByPkgId[pkgResponse.body.id]) {
      const mp = ctx.missingPeersOfChildrenByPkgId[pkgResponse.body.id];

      // This if condition is used to avoid a dead lock.
      // There might be a better way to hoist peer dependencies during resolution
      // but it would probably require a big rewrite of the resolution algorithm.
      if (
        typeof mp !== 'undefined' &&
        (mp.depth >= options.currentDepth ||
          mp.missingPeersOfChildren.resolved === true)
      ) {
        missingPeersOfChildren = mp.missingPeersOfChildren;
      }
    } else {
      const p = pDefer<MissingPeers>();

      missingPeersOfChildren = {
        resolve: p.resolve,
        reject: p.reject,
        get: pShare(p.promise),
      };

      ctx.missingPeersOfChildrenByPkgId[pkgResponse.body.id] = {
        depth: options.currentDepth,
        missingPeersOfChildren,
      };
    }
  }

  const p: PkgAddress = {
    alias: newWantedDependency.alias ?? pkg.name,
    depIsLinked,
    isNew,
    nodeId,
    normalizedPref:
      options.currentDepth === 0 ? pkgResponse.body.normalizedPref : undefined,
    missingPeersOfChildren,
    pkgId: pkgResponse.body.id,
    rootDir,
    missingPeers: getMissingPeers(pkg),
    optional: ctx.resolvedPkgsById[pkgResponse.body.id]?.optional ?? false,

    // Next fields are actually only needed when isNew = true
    installable,
    // isLinkedDependency: undefined,
    pkg,
    updated: pkgResponse.body.updated,
    publishedAt: pkgResponse.body.publishedAt,
  } satisfies PkgAddress;

  return p;
}

function getManifestFromResponse(
  pkgResponse: PackageResponse,
  wantedDependency: WantedDependency
): PackageManifest {
  if (typeof pkgResponse.body?.manifest !== 'undefined') {
    return pkgResponse.body.manifest;
  }

  return {
    name: wantedDependency.pref?.split('/').pop() ?? '',
    version: '0.0.0',
  };
}

function getMissingPeers(pkg: PackageManifest): MissingPeers {
  const missingPeers = {} as MissingPeers;

  for (const [peerName, peerVersion] of Object.entries(
    pkg.peerDependencies ?? {}
  )) {
    missingPeers[peerName] = {
      range: peerVersion,
      optional: pkg.peerDependenciesMeta?.[peerName]?.optional === true,
    };
  }

  return missingPeers;
}

function pkgIsLeaf(pkg: PackageManifest): boolean {
  return (
    Object.keys(pkg.dependencies ?? {}).length === 0 &&
    Object.keys(pkg.optionalDependencies ?? {}).length === 0 &&
    Object.keys(pkg.peerDependencies ?? {}).length === 0 &&
    // Package manifests can declare peerDependenciesMeta without declaring
    // peerDependencies. peerDependenciesMeta implies the later.
    Object.keys(pkg.peerDependenciesMeta ?? {}).length === 0
  );
}

function getResolvedPackage(options: {
  dependencyLockfile?: PackageSnapshot | undefined;
  pkgIdWithPatchHash: PkgIdWithPatchHash;
  force: boolean;
  hasBin: boolean;
  parentImporterId: string;
  patch?: PatchInfo | undefined;
  pkg: PackageManifest;
  pkgResponse: PackageResponse;
  prepare: boolean;
  optional: boolean;
  wantedDependency: WantedDependency;
}): ResolvedPackage {
  const peerDependencies = peerDependenciesWithoutOwn(options.pkg);

  if (typeof options.pkgResponse.body === 'undefined') {
    throw new Error('options.pkgResponse.body is undefined');
  }

  return {
    additionalInfo: {
      bundledDependencies: options.pkg.bundledDependencies,
      bundleDependencies: options.pkg.bundleDependencies,
      cpu: options.pkg.cpu,
      deprecated: options.pkg.deprecated,
      engines: options.pkg.engines,
      os: options.pkg.os,
      libc: options.pkg.libc,
    },
    transitivePeerDependencies: new Set<string>(),
    isLeaf: pkgIsLeaf(options.pkg),
    pkgIdWithPatchHash: options.pkgIdWithPatchHash,
    dev: options.wantedDependency.dev,
    fetching: options.pkgResponse.fetching,
    filesIndexFile: options.pkgResponse.filesIndexFile,
    hasBin: options.hasBin,
    hasBundledDependencies: !(
      (options.pkg.bundledDependencies ?? options.pkg.bundleDependencies) ==
      null
    ),
    id: options.pkgResponse.body.id,
    name: options.pkg.name,
    optional: options.optional,
    optionalDependencies: new Set(
      Object.keys(options.pkg.optionalDependencies ?? {})
    ),
    patch: options.patch,
    peerDependencies,
    prepare: options.prepare,
    prod:
      options.wantedDependency.dev !== true &&
      options.wantedDependency.optional !== true,
    resolution: options.pkgResponse.body.resolution,
    version: options.pkg.version,
  };
}

function peerDependenciesWithoutOwn(pkg: PackageManifest): PeerDependencies {
  if (pkg.peerDependencies == null && pkg.peerDependenciesMeta == null) {
    return {};
  }

  const ownDeps = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  const result: PeerDependencies = {};

  if (pkg.peerDependencies != null) {
    for (const [peerName, peerRange] of Object.entries(pkg.peerDependencies)) {
      if (ownDeps.has(peerName)) {
        continue;
      }

      result[peerName] = {
        version: peerRange,
      };
    }
  }

  if (typeof pkg.peerDependenciesMeta !== 'undefined') {
    for (const [peerName, peerMeta] of Object.entries(
      pkg.peerDependenciesMeta
    )) {
      if (ownDeps.has(peerName) || peerMeta.optional !== true) {
        continue;
      }

      if (!result[peerName]) {
        result[peerName] = { version: '*' };
      }

      result[peerName].optional = true;
    }
  }

  return result;
}
