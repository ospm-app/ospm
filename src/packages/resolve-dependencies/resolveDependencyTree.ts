import { resolveFromCatalog } from '../catalogs.resolver/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import type { PatchGroupRecord } from '../patching.types/index.ts';
import type {
  PreferredVersions,
  Resolution,
  WorkspacePackages,
} from '../resolver-base/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../store-controller-types/index.ts';
import type {
  SupportedArchitectures,
  AllowedDeprecatedVersions,
  PkgResolutionId,
  ProjectManifest,
  ProjectId,
  ReadPackageHook,
  Registries,
  ProjectRootDir,
  GlobalPkgDir,
  LockFileDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import partition from 'ramda/src/partition';
import zipObj from 'ramda/src/zipObj';
// import type { WantedDependency } from './getNonDevWantedDependencies.ts';
import { type NodeId, nextNodeId } from './nextNodeId.ts';
import { parentIdsContainSequence } from './parentIdsContainSequence.ts';
import {
  type ChildrenByParentId,
  type DependenciesTree,
  type LinkedDependency,
  type ImporterToResolve,
  type ImporterToResolveOptions,
  type ParentPkgAliases,
  type PendingNode,
  type PkgAddress,
  resolveRootDependencies,
  type ResolvedPackage,
  type ResolvedPkgsById,
  type ResolutionContext,
} from './resolveDependencies.ts';
import type { WantedDependency } from './getWantedDependencies.ts';

export type {
  LinkedDependency,
  ResolvedPackage,
  DependenciesTree,
  DependenciesTreeNode,
} from './resolveDependencies.ts';

export type ResolvedImporters = {
  [id: string]: {
    directDependencies: (LinkedDependency | ResolvedDirectDependency)[];
    directNodeIdsByAlias: Map<string, NodeId>;
    linkedDependencies: LinkedDependency[];
  };
};

export type ResolvedDirectDependency = {
  alias: string;
  optional?: boolean | undefined;
  dev?: boolean | undefined;
  resolution?: Resolution | undefined;
  pkgId: PkgResolutionId;
  version: string;
  name: string;
  normalizedPref?: string | undefined;
  catalogLookup?: CatalogLookupMetadata | undefined;
};

/**
 * Information related to the catalog entry for this dependency if it was
 * requested through the catalog protocol.
 */
export type CatalogLookupMetadata = {
  readonly catalogName: string;
  readonly specifier: string;

  /**
   * The catalog protocol pref the user wrote in package.json files or as a
   * parameter to pnpm add. Ex: pnpm add foo@catalog:
   *
   * This will usually be 'catalog:<name>', but can simply be 'catalog:' if
   * users wrote the default catalog shorthand. This is different than the
   * catalogName field, which would be 'default' regardless of whether users
   * originally requested 'catalog:' or 'catalog:default'.
   */
  readonly userSpecifiedPref?: string | undefined;
};

export type Importer<WantedDepExtraProps> = {
  id: ProjectId;
  manifest: ProjectManifest;
  modulesDir: string;
  removePackages?: string[] | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  wantedDependencies: Array<WantedDependency & WantedDepExtraProps>;
};

export type ImporterToResolveGeneric<WantedDepExtraProps> = {
  id: ProjectId;
  binsDir: string;
  manifest?: ProjectManifest | undefined;
  modulesDir: string;
  removePackages?: string[] | undefined;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
  wantedDependencies: Array<WantedDependency & WantedDepExtraProps>;
  updatePackageManifest?: boolean | undefined;
  updateMatching?: ((pkgName: string) => boolean) | undefined;
  updateToLatest?: boolean | undefined;
  hasRemovedDependencies?: boolean | undefined;
  preferredVersions?: PreferredVersions | undefined;
  originalManifest?: ProjectManifest | undefined;
};

export interface ResolveDependenciesOptions {
  autoInstallPeers?: boolean | undefined;
  autoInstallPeersFromHighestMatch?: boolean | undefined;
  allowedDeprecatedVersions: AllowedDeprecatedVersions;
  allowUnusedPatches: boolean;
  catalogs?: Catalogs | undefined;
  currentLockfile: LockfileObject;
  dedupePeerDependents?: boolean | undefined;
  dryRun: boolean;
  engineStrict: boolean;
  force: boolean;
  forceFullResolution: boolean;
  ignoreScripts?: boolean | undefined;
  hooks: {
    readPackage?: ReadPackageHook | undefined;
  };
  nodeVersion?: string | undefined;
  registries: Registries;
  patchedDependencies?: PatchGroupRecord | undefined;
  pnpmVersion: string;
  preferredVersions?: PreferredVersions | undefined;
  preferWorkspacePackages?: boolean | undefined;
  resolutionMode?: 'highest' | 'time-based' | 'lowest-direct' | undefined;
  resolvePeersFromWorkspaceRoot?: boolean | undefined;
  injectWorkspacePackages?: boolean | undefined;
  linkWorkspacePackagesDepth?: number | undefined;
  lockfileDir: LockFileDir;
  storeController: StoreController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  tag: string;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  wantedLockfile: LockfileObject;
  workspacePackages: WorkspacePackages;
  supportedArchitectures?: SupportedArchitectures | undefined;
  peersSuffixMaxLength: number;
}

export interface ResolveDependencyTreeResult {
  allPeerDepNames: Set<string>;
  dependenciesTree: DependenciesTree;
  outdatedDependencies: {
    [pkgId: string]: string;
  };
  resolvedImporters: ResolvedImporters;
  resolvedPkgsById: ResolvedPkgsById;
  wantedToBeSkippedPackageIds: Set<string>;
  appliedPatches: Set<string>;
  time?: Record<string, string> | undefined;
}

export async function resolveDependencyTree(
  importers: Array<
    ImporterToResolveGeneric<{
      isNew?: boolean | undefined;
      updateDepth?: number | undefined;
    }>
  >,
  opts: ResolveDependenciesOptions
): Promise<ResolveDependencyTreeResult> {
  const wantedToBeSkippedPackageIds = new Set<PkgResolutionId>();

  const autoInstallPeers = opts.autoInstallPeers === true;

  const ctx: ResolutionContext = {
    autoInstallPeers,
    autoInstallPeersFromHighestMatch:
      opts.autoInstallPeersFromHighestMatch === true,
    allowedDeprecatedVersions: opts.allowedDeprecatedVersions,
    catalogResolver: resolveFromCatalog.bind(null, opts.catalogs ?? {}),
    childrenByParentId: {} as ChildrenByParentId,
    currentLockfile: opts.currentLockfile,
    defaultTag: opts.tag,
    dependenciesTree: new Map() as DependenciesTree,
    dryRun: opts.dryRun,
    engineStrict: opts.engineStrict,
    force: opts.force,
    forceFullResolution: opts.forceFullResolution,
    ignoreScripts: opts.ignoreScripts,
    injectWorkspacePackages: opts.injectWorkspacePackages,
    linkWorkspacePackagesDepth: opts.linkWorkspacePackagesDepth ?? -1,
    lockfileDir: opts.lockfileDir,
    nodeVersion: opts.nodeVersion,
    outdatedDependencies: {} as { [pkgId: string]: string },
    patchedDependencies: opts.patchedDependencies,
    pendingNodes: [] as PendingNode[],
    pnpmVersion: opts.pnpmVersion,
    preferWorkspacePackages: opts.preferWorkspacePackages,
    readPackageHook: opts.hooks.readPackage,
    registries: opts.registries,
    resolvedPkgsById: {} as ResolvedPkgsById,
    resolutionMode: opts.resolutionMode,
    skipped: wantedToBeSkippedPackageIds,
    storeController: opts.storeController,
    virtualStoreDir: opts.virtualStoreDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    wantedLockfile: opts.wantedLockfile,
    appliedPatches: new Set<string>(),
    updatedSet: new Set<string>(),
    workspacePackages: opts.workspacePackages,
    missingPeersOfChildrenByPkgId: {},
    hoistPeers: autoInstallPeers || opts.dedupePeerDependents,
    allPeerDepNames: new Set(),
  };

  const resolveArgs: ImporterToResolve[] = importers.map(
    (
      importer: ImporterToResolveGeneric<{
        isNew?: boolean | undefined;
        updateDepth?: number | undefined;
      }>
    ): {
      updatePackageManifest: boolean;
      parentPkgAliases: ParentPkgAliases;
      preferredVersions: PreferredVersions;
      wantedDependencies: (WantedDependency & {
        isNew?: boolean | undefined;
        updateDepth?: number | undefined;
      })[];
      options: ImporterToResolveOptions;
    } => {
      const projectSnapshot = opts.wantedLockfile.importers?.[importer.id];

      // This may be optimized.
      // We only need to proceed resolving every dependency
      // if the newly added dependency has peer dependencies.
      const proceed =
        importer.id === '.' ||
        importer.hasRemovedDependencies === true ||
        importer.wantedDependencies.some(
          (
            wantedDep: WantedDependency & {
              updateDepth?: number | undefined;
              isNew?: boolean | undefined;
            }
          ): boolean => {
            return wantedDep.isNew === true;
          }
        );

      const resolveOpts: ImporterToResolveOptions = {
        currentDepth: 0,
        parentPkg: {
          installable: true,
          nodeId: importer.id as unknown as NodeId,
          optional: false,
          pkgId: importer.id as unknown as PkgResolutionId,
          rootDir: importer.rootDir,
        },
        parentIds: [importer.id as unknown as PkgResolutionId],
        proceed,
        resolvedDependencies: {
          ...projectSnapshot?.dependencies,
          ...projectSnapshot?.devDependencies,
          ...projectSnapshot?.optionalDependencies,
        },
        updateDepth: -1,
        updateMatching: importer.updateMatching,
        updateToLatest: importer.updateToLatest,
        prefix: importer.rootDir,
        supportedArchitectures: opts.supportedArchitectures,
      };

      return {
        updatePackageManifest: importer.updatePackageManifest ?? false,
        parentPkgAliases: Object.fromEntries(
          importer.wantedDependencies
            .filter(
              ({
                alias,
              }: WantedDependency & {
                isNew?: boolean | undefined;
                updateDepth?: number | undefined;
              }): boolean => {
                return typeof alias === 'string';
              }
            )
            .map(
              ({
                alias,
              }: WantedDependency & {
                isNew?: boolean | undefined;
                updateDepth?: number | undefined;
              }): [string, true] => {
                return [alias as string, true];
              }
            )
        ), // as ParentPkgAliases,
        preferredVersions: importer.preferredVersions ?? {},
        wantedDependencies: importer.wantedDependencies,
        options: resolveOpts,
      };
    }
  );

  const { pkgAddressesByImporters, time } = await resolveRootDependencies(
    ctx,
    resolveArgs
  );

  const directDepsByImporterId = zipObj.default(
    importers.map(
      ({
        id,
      }: ImporterToResolveGeneric<{
        isNew?: boolean | undefined;
        updateDepth?: number | undefined;
      }>): ProjectId => {
        return id;
      }
    ),
    // @ts-expect-error The types of 'pkg.publishConfig' are incompatible between these types.
    // Type 'PublishConfig | undefined' is not assignable to type 'NarrowRaw<PublishConfig | undefined>'.
    pkgAddressesByImporters
  );

  for (const pendingNode of ctx.pendingNodes) {
    ctx.dependenciesTree.set(pendingNode.nodeId, {
      children: (): Record<string, NodeId> => {
        const id = pendingNode.resolvedPackage.id;

        if (typeof id === 'undefined') {
          return {};
        }

        const children = ctx.childrenByParentId[id];

        if (typeof children === 'undefined') {
          return {};
        }

        return buildTree(
          ctx,
          id,
          pendingNode.parentIds,
          children,
          pendingNode.depth + 1,
          pendingNode.installable
        );
      },
      depth: pendingNode.depth,
      installable: pendingNode.installable,
      resolvedPackage: pendingNode.resolvedPackage,
    });
  }

  const resolvedImporters: ResolvedImporters = {};

  for (const { id, wantedDependencies } of importers) {
    const dd = directDepsByImporterId[id];

    if (typeof dd === 'undefined') {
      continue;
    }

    const directDeps = dedupeSameAliasDirectDeps(dd, wantedDependencies);

    const parts = partition.default(
      (dep: PkgAddress | LinkedDependency): dep is LinkedDependency => {
        return dep.isLinkedDependency === true;
      },
      directDeps
    );

    const linkedDependencies: LinkedDependency[] = parts[0];

    const directNonLinkedDeps: PkgAddress[] = parts[1];

    resolvedImporters[id] = {
      directDependencies: directDeps
        .map(
          (
            dep: PkgAddress | LinkedDependency
          ): LinkedDependency | ResolvedDirectDependency | undefined => {
            if (dep.isLinkedDependency === true) {
              return dep;
            }

            const resolvedPackage:
              | (ResolvedPackage & { name: string; version: string })
              | { name: string; version: string }
              | undefined = ctx.dependenciesTree.get(
              dep.nodeId
            )?.resolvedPackage;

            if (
              typeof resolvedPackage === 'undefined' ||
              !('id' in resolvedPackage)
            ) {
              return;
            }

            const rd: ResolvedDirectDependency = {
              alias: dep.alias,
              catalogLookup: dep.catalogLookup,
              dev: resolvedPackage.dev,
              name: resolvedPackage.name,
              normalizedPref: dep.normalizedPref,
              optional: resolvedPackage.optional,
              pkgId: resolvedPackage.id,
              resolution: resolvedPackage.resolution,
              version: resolvedPackage.version,
            } satisfies ResolvedDirectDependency;

            return rd;
          }
        )
        .filter(Boolean),
      directNodeIdsByAlias: new Map(
        directNonLinkedDeps.map(
          ({ alias, nodeId }: PkgAddress): [string, NodeId] => {
            return [alias, nodeId];
          }
        )
      ),
      linkedDependencies,
    };
  }

  return {
    dependenciesTree: ctx.dependenciesTree,
    outdatedDependencies: ctx.outdatedDependencies,
    resolvedImporters,
    resolvedPkgsById: ctx.resolvedPkgsById,
    wantedToBeSkippedPackageIds,
    appliedPatches: ctx.appliedPatches,
    time,
    allPeerDepNames: ctx.allPeerDepNames,
  };
}

function buildTree(
  ctx: {
    childrenByParentId: ChildrenByParentId;
    dependenciesTree: DependenciesTree;
    resolvedPkgsById: ResolvedPkgsById;
    skipped: Set<PkgResolutionId>;
  },
  parentId: PkgResolutionId,
  parentIds: PkgResolutionId[],
  children: Array<{ alias: string; id: PkgResolutionId }>,
  depth: number,
  installable: boolean
): Record<string, NodeId> {
  const childrenNodeIds: Record<string, NodeId> = {};

  for (const child of children) {
    if (child.id.startsWith('link:')) {
      childrenNodeIds[child.alias] = child.id as unknown as NodeId;

      continue;
    }

    if (
      parentIdsContainSequence(parentIds, parentId, child.id) ||
      parentId === child.id
    ) {
      continue;
    }

    if (ctx.resolvedPkgsById[child.id]?.isLeaf === true) {
      childrenNodeIds[child.alias] = child.id as unknown as NodeId;

      continue;
    }

    const childNodeId = nextNodeId();

    childrenNodeIds[child.alias] = childNodeId;

    const newInstallable = installable || !ctx.skipped.has(child.id);

    const children = ctx.childrenByParentId[child.id];

    const resolvedPackage = ctx.resolvedPkgsById[child.id];

    if (
      typeof children === 'undefined' ||
      typeof resolvedPackage === 'undefined'
    ) {
      return {};
    }

    ctx.dependenciesTree.set(childNodeId, {
      children: (): Record<string, NodeId> => {
        return buildTree(
          ctx,
          child.id,
          [...parentIds, child.id],
          children,
          depth + 1,
          newInstallable
        );
      },
      depth,
      installable: newInstallable,
      resolvedPackage,
    });
  }

  return childrenNodeIds;
}

/**
 * There may be cases where multiple dependencies have the same alias in the directDeps array.
 * E.g., when there is "is-negative: github:kevva/is-negative#1.0.0" in the package.json dependencies,
 * and then re-execute `pnpm add github:kevva/is-negative#1.0.1`.
 * In order to make sure that the latest 1.0.1 version is installed, we need to remove the duplicate dependency.
 * fix https://github.com/pnpm/pnpm/issues/6966
 */
function dedupeSameAliasDirectDeps(
  directDeps: Array<PkgAddress | LinkedDependency>,
  wantedDependencies: Array<WantedDependency & { isNew?: boolean | undefined }>
): Array<PkgAddress | LinkedDependency> {
  const deps = new Map<string, PkgAddress | LinkedDependency>();

  for (const directDep of directDeps) {
    const { alias, normalizedPref } = directDep;

    if (deps.has(alias) === true) {
      const wantedDep = wantedDependencies.find(
        (
          dep: WantedDependency & {
            isNew?: boolean | undefined;
          }
        ): boolean => {
          return typeof dep.alias === 'string'
            ? dep.alias === alias
            : dep.pref === normalizedPref;
        }
      );

      if (wantedDep?.isNew === true) {
        deps.set(alias, directDep);
      }
    } else {
      deps.set(alias, directDep);
    }
  }

  return Array.from(deps.values());
}
