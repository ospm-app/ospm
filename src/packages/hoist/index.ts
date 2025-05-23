import fs from 'node:fs';
import path from 'node:path';
import { linkLogger } from '../core-loggers/index.ts';
import { WANTED_LOCKFILE } from '../constants/index.ts';
import {
  linkBinsOfPkgsByAliases,
  type WarnFunction,
} from '../link-bins/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import {
  lockfileWalker,
  type LockfileWalkerStep,
} from '../lockfile.walker/index.ts';
import { logger } from '../logger/index.ts';
import { createMatcher } from '../matcher/index.ts';
import type {
  DepPath,
  HoistedDependencies,
  ModulesDir,
  ProjectId,
} from '../types/index.ts';
import { lexCompare } from '../util.lex-comparator/index.ts';
import * as dp from '../dependency-path/index.ts';
import isSubdir from 'is-subdir';
import mapObjIndexed from 'ramda/src/mapObjIndexed';
import resolveLinkTarget from 'resolve-link-target';
import symlinkDir from 'symlink-dir';
import type { LockfileObject } from '../lockfile.types/index.ts';

const hoistLogger = logger('hoist');

export interface HoistOpts extends GetHoistedDependenciesOpts {
  extraNodePath?: string[] | undefined;
  preferSymlinkedExecutables?: boolean | undefined;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
}

export async function hoist(opts: HoistOpts): Promise<HoistedDependencies> {
  const result = getHoistedDependencies(opts);

  if (!result) {
    return {};
  }

  const { hoistedDependencies, hoistedAliasesWithBins } = result;

  await symlinkHoistedDependencies(hoistedDependencies, {
    lockfile: opts.lockfile,
    privateHoistedModulesDir: opts.privateHoistedModulesDir,
    publicHoistedModulesDir: opts.publicHoistedModulesDir,
    virtualStoreDir: opts.virtualStoreDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    hoistedWorkspacePackages: opts.hoistedWorkspacePackages,
  });

  // Here we only link the bins of the privately hoisted modules.
  // The bins of the publicly hoisted modules will be linked together with
  // the bins of the project's direct dependencies.
  // This is possible because the publicly hoisted modules
  // are in the same directory as the regular dependencies.
  await linkAllBins(opts.privateHoistedModulesDir, {
    extraNodePaths: opts.extraNodePath,
    hoistedAliasesWithBins,
    preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
  });

  return hoistedDependencies;
}

export type GetHoistedDependenciesOpts = {
  lockfile: LockfileObject;
  importerIds?: ProjectId[] | undefined;
  privateHoistPattern: string[];
  privateHoistedModulesDir: ModulesDir;
  publicHoistPattern: string[];
  publicHoistedModulesDir: string;
  hoistedWorkspacePackages?:
    | Record<ProjectId, HoistedWorkspaceProject>
    | undefined;
};

export type HoistedWorkspaceProject = {
  name: string;
  dir: string;
};

export function getHoistedDependencies(
  opts: GetHoistedDependenciesOpts
): HoistGraphResult | null {
  if (opts.lockfile.packages == null) {
    return null;
  }

  const { directDeps, step } = lockfileWalker(
    opts.lockfile,
    opts.importerIds ??
      (Object.keys(opts.lockfile.importers ?? {}) as ProjectId[])
  );

  // We want to hoist all the workspace packages, not only those that are in the dependencies
  // of any other workspace packages.
  // That is why we can't just simply use the lockfile walker to include links to local workspace packages too.
  // We have to explicitly include all the workspace packages.
  const hoistedWorkspaceDeps: Record<string, ProjectId> = Object.fromEntries(
    Object.entries(opts.hoistedWorkspacePackages ?? {}).map(
      ([id, { name }]: [string, HoistedWorkspaceProject]): [
        string,
        ProjectId,
      ] => {
        return [name, id as ProjectId];
      }
    )
  );

  const deps: Dependency[] = [
    {
      children: {
        ...hoistedWorkspaceDeps,
        ...directDeps.reduce(
          (acc, { alias, depPath }) => {
            if (!acc[alias]) {
              acc[alias] = depPath;
            }
            return acc;
          },
          {} as Record<string, DepPath>
        ),
      },
      depPath: '',
      depth: -1,
    },
    ...getDependencies(0, step),
  ];

  const getAliasHoistType = createGetAliasHoistType(
    opts.publicHoistPattern,
    opts.privateHoistPattern
  );

  return hoistGraph(
    deps,
    opts.lockfile.importers?.['.' as ProjectId]?.specifiers ?? {},
    {
      getAliasHoistType,
      lockfile: opts.lockfile,
    }
  );
}

type GetAliasHoistType = (alias: string) => 'private' | 'public' | false;

function createGetAliasHoistType(
  publicHoistPattern: string[],
  privateHoistPattern: string[]
): GetAliasHoistType {
  const publicMatcher = createMatcher(publicHoistPattern);

  const privateMatcher = createMatcher(privateHoistPattern);

  return (alias: string): false | 'public' | 'private' => {
    if (publicMatcher(alias)) {
      return 'public';
    }

    if (privateMatcher(alias)) {
      return 'private';
    }

    return false;
  };
}

interface LinkAllBinsOptions {
  extraNodePaths?: string[] | undefined;
  hoistedAliasesWithBins: string[];
  preferSymlinkedExecutables?: boolean | undefined;
}

async function linkAllBins(
  modulesDir: ModulesDir,
  opts: LinkAllBinsOptions
): Promise<void> {
  const bin = path.join(modulesDir, '.bin');

  const warn: WarnFunction = (message, code) => {
    if (code === 'BINARIES_CONFLICT') return;
    logger.info({ message, prefix: path.join(modulesDir, '../..') });
  };

  try {
    await linkBinsOfPkgsByAliases(opts.hoistedAliasesWithBins, bin, {
      allowExoticManifests: true,
      extraNodePaths: opts.extraNodePaths,
      modulesDir,
      preferSymlinkedExecutables: opts.preferSymlinkedExecutables,
      warn,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    // Some packages generate their commands with lifecycle hooks.
    // At this stage, such commands are not generated yet.
    // For now, we don't hoist such generated commands.
    // Related issue: https://github.com/pnpm/pnpm/issues/2071
  }
}

function getDependencies(
  depth: number,
  step: LockfileWalkerStep
): Dependency[] {
  const deps: Dependency[] = [];

  const nextSteps: LockfileWalkerStep[] = [];

  for (const { pkgSnapshot, depPath, next } of step.dependencies) {
    const allDeps: Record<string, string> = {
      ...pkgSnapshot.dependencies,
      ...pkgSnapshot.optionalDependencies,
    };

    deps.push({
      children: mapObjIndexed.default(dp.refToRelative, allDeps) as Record<
        string,
        DepPath
      >,
      depPath,
      depth,
    });

    nextSteps.push(next());
  }

  for (const depPath of step.missing) {
    // It might make sense to fail if the depPath is not in the skipped list from .modules.yaml
    // However, the skipped list currently contains package IDs, not dep paths.
    logger.debug({
      message: `No entry for "${depPath}" in ${WANTED_LOCKFILE}`,
    });
  }

  return [...deps, ...nextSteps.flatMap(getDependencies.bind(null, depth + 1))];
}

export type Dependency = {
  children: Record<string, DepPath | ProjectId>;
  depPath: string;
  depth: number;
};

type HoistGraphResult = {
  hoistedDependencies: HoistedDependencies;
  hoistedAliasesWithBins: string[];
};

function hoistGraph(
  depNodes: Dependency[],
  currentSpecifiers: Record<string, string>,
  opts: {
    getAliasHoistType: GetAliasHoistType;
    lockfile: LockfileObject;
  }
): HoistGraphResult {
  const hoistedAliases = new Set(Object.keys(currentSpecifiers));

  const hoistedDependencies: HoistedDependencies = {};

  const hoistedAliasesWithBins = new Set<string>();

  // biome-ignore lint/complexity/noForEach: <explanation>
  depNodes
    // sort by depth and then alphabetically
    .sort((a: Dependency, b: Dependency): number => {
      const depthDiff = a.depth - b.depth;
      return depthDiff === 0 ? lexCompare(a.depPath, b.depPath) : depthDiff;
    })
    // build the alias map and the id map
    .forEach((depNode) => {
      for (const [childAlias, childPath] of Object.entries<DepPath | ProjectId>(
        depNode.children
      )) {
        const hoist = opts.getAliasHoistType(childAlias);

        if (hoist === false) {
          continue;
        }

        const childAliasNormalized = childAlias.toLowerCase();
        // if this alias has already been taken, skip it

        if (hoistedAliases.has(childAliasNormalized)) {
          continue;
        }

        if (opts.lockfile.packages?.[childPath as DepPath]?.hasBin === true) {
          hoistedAliasesWithBins.add(childAlias);
        }

        hoistedAliases.add(childAliasNormalized);

        if (!hoistedDependencies[childPath]) {
          hoistedDependencies[childPath] = {};
        }

        hoistedDependencies[childPath][childAlias] = hoist;
      }
    });

  return {
    hoistedDependencies,
    hoistedAliasesWithBins: Array.from(hoistedAliasesWithBins),
  };
}

async function symlinkHoistedDependencies(
  hoistedDependencies: HoistedDependencies,
  opts: {
    lockfile: LockfileObject;
    privateHoistedModulesDir: string;
    publicHoistedModulesDir: string;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    hoistedWorkspacePackages?:
      | Record<string, HoistedWorkspaceProject>
      | undefined;
  }
): Promise<void> {
  const symlink = symlinkHoistedDependency.bind(null, opts);

  await Promise.all(
    Object.entries(hoistedDependencies).map(
      async ([hoistedDepId, pkgAliases]: [
        string,
        Record<string, 'public' | 'private'>,
      ]): Promise<void> => {
        const pkgSnapshot = opts.lockfile.packages?.[hoistedDepId as DepPath];

        let depLocation: string | undefined;

        if (typeof pkgSnapshot === 'undefined') {
          if (!opts.lockfile.importers?.[hoistedDepId as ProjectId]) {
            // This dependency is probably a skipped optional dependency.
            hoistLogger.debug({ hoistFailedFor: hoistedDepId });

            return;
          }

          depLocation = opts.hoistedWorkspacePackages?.[hoistedDepId]?.dir;
        } else {
          const pkgName = nameVerFromPkgSnapshot(
            hoistedDepId,
            pkgSnapshot
          ).name;

          const modules = path.join(
            opts.virtualStoreDir,
            dp.depPathToFilename(hoistedDepId, opts.virtualStoreDirMaxLength),
            'node_modules'
          );

          depLocation = path.join(modules, pkgName as string);
        }

        await Promise.all(
          Object.entries(pkgAliases).map(
            async ([pkgAlias, hoistType]: [
              string,
              'private' | 'public',
            ]): Promise<void> => {
              const targetDir =
                hoistType === 'public'
                  ? opts.publicHoistedModulesDir
                  : opts.privateHoistedModulesDir;

              const dest = path.join(targetDir, pkgAlias);

              if (typeof depLocation !== 'undefined') {
                return symlink(depLocation, dest);
              }

              return;
            }
          )
        );
      }
    )
  );
}

async function symlinkHoistedDependency(
  opts: { virtualStoreDir: string },
  depLocation: string,
  dest: string
): Promise<void> {
  try {
    await symlinkDir(depLocation, dest, { overwrite: false });
    linkLogger.debug({ target: dest, link: depLocation });
    return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'EEXIST' && err.code !== 'EISDIR') throw err;
  }

  let existingSymlink: string | undefined;

  try {
    existingSymlink = await resolveLinkTarget(dest);
  } catch {
    hoistLogger.debug({
      skipped: dest,
      reason: 'a directory is present at the target location',
    });

    return;
  }

  if (!isSubdir(opts.virtualStoreDir, existingSymlink)) {
    hoistLogger.debug({
      skipped: dest,
      existingSymlink,
      reason: 'an external symlink is present at the target location',
    });

    return;
  }

  await fs.promises.unlink(dest);

  await symlinkDir(depLocation, dest);

  linkLogger.debug({ target: dest, link: depLocation });
}
