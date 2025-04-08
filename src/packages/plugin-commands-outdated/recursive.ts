import { TABLE_OPTIONS } from '../cli-utils/index.ts';
import { PnpmError } from '../error/index.ts';
import {
  outdatedDepsOfProjects,
  type OutdatedPackage,
} from '../outdated/index.ts';
import type {
  DependenciesField,
  IncludedDependencies,
  ProjectManifest,
  ProjectRootDir,
} from '../types/index.ts';
import { table } from '@zkochan/table';
import chalk from 'chalk';
import isEmpty from 'ramda/src/isEmpty';
import sortWith from 'ramda/src/sortWith';
import {
  getCellWidth,
  type OutdatedCommandOptions,
  type OutdatedPackageJSONOutput,
  renderCurrent,
  renderDetails,
  renderLatest,
  renderPackageName,
  toOutdatedWithVersionDiff,
} from './outdated.ts';
import { DEFAULT_COMPARATORS, type OutdatedWithVersionDiff } from './utils.ts';

const DEP_PRIORITY: Record<DependenciesField, number> = {
  dependencies: 1,
  devDependencies: 2,
  optionalDependencies: 0,
};

const COMPARATORS = [
  ...DEFAULT_COMPARATORS,
  (o1: OutdatedInWorkspace, o2: OutdatedInWorkspace) =>
    DEP_PRIORITY[o1.belongsTo] - DEP_PRIORITY[o2.belongsTo],
];

interface OutdatedInWorkspace extends OutdatedPackage {
  belongsTo: DependenciesField;
  current?: string | undefined;
  dependentPkgs: Array<{ location: string; manifest: ProjectManifest }>;
  latest?: string | undefined;
  packageName: string;
  wanted: string;
}

export async function outdatedRecursive(
  pkgs: Array<{ rootDir: ProjectRootDir; manifest: ProjectManifest }>,
  params: string[],
  opts: OutdatedCommandOptions & { include: IncludedDependencies }
): Promise<{ output: string; exitCode: number }> {
  const outdatedMap = {} as Record<string, OutdatedInWorkspace>;

  const rootManifest = pkgs.find(
    ({
      rootDir,
    }: {
      rootDir: ProjectRootDir;
      manifest: ProjectManifest;
    }): boolean => {
      return (rootDir as string) === opts.lockfileDir;
    }
  );

  const outdatedPackagesByProject = await outdatedDepsOfProjects(pkgs, params, {
    ...opts,
    fullMetadata: opts.long ?? false,
    ignoreDependencies:
      rootManifest?.manifest.pnpm?.updateConfig?.ignoreDependencies,
    retry: {
      factor: opts.fetchRetryFactor ?? 3,
      maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
      minTimeout: opts.fetchRetryMintimeout ?? 1_000,
      retries: opts.fetchRetries ?? 3,
    },
    timeout: opts.fetchTimeout,
  });
  for (let i = 0; i < outdatedPackagesByProject.length; i++) {
    const pkg = pkgs[i];

    if (typeof pkg === 'undefined') {
      continue;
    }

    const { rootDir, manifest } = pkg;

    for (const outdatedPkg of outdatedPackagesByProject[i] ?? []) {
      const key = JSON.stringify([
        outdatedPkg.packageName,
        outdatedPkg.current,
        outdatedPkg.belongsTo,
      ]);

      if (!outdatedMap[key]) {
        outdatedMap[key] = { ...outdatedPkg, dependentPkgs: [] };
      }

      outdatedMap[key].dependentPkgs.push({ location: rootDir, manifest });
    }
  }

  let output!: string;

  switch (opts.format ?? 'table') {
    case 'table': {
      output = renderOutdatedTable(outdatedMap, opts);

      break;
    }

    case 'list': {
      output = renderOutdatedList(outdatedMap, opts);

      break;
    }

    case 'json': {
      output = renderOutdatedJSON(outdatedMap, opts);

      break;
    }

    default: {
      throw new PnpmError(
        'BAD_OUTDATED_FORMAT',
        `Unsupported format: ${opts.format?.toString() ?? 'undefined'}`
      );
    }
  }
  return {
    output,
    exitCode: isEmpty.default(outdatedMap) ? 0 : 1,
  };
}

function renderOutdatedTable(
  outdatedMap: Record<string, OutdatedInWorkspace>,
  opts: { long?: boolean | undefined }
): string {
  if (isEmpty.default(outdatedMap)) return '';
  const columnNames = ['Package', 'Current', 'Latest', 'Dependents'];

  const columnFns = [
    renderPackageName,
    renderCurrent,
    renderLatest,
    dependentPackages,
  ];

  if (opts.long === true) {
    columnNames.push('Details');
    columnFns.push(renderDetails);
  }

  // Avoid the overhead of allocating a new array caused by calling `array.map()`
  for (let i = 0; i < columnNames.length; i++)
    columnNames[i] = chalk.blueBright(columnNames[i]);

  const data = [
    columnNames,
    ...sortOutdatedPackages(Object.values(outdatedMap)).map((outdatedPkg) =>
      columnFns.map((fn) => fn(outdatedPkg))
    ),
  ];
  return table(data, {
    ...TABLE_OPTIONS,
    columns: {
      ...TABLE_OPTIONS.columns,
      // Dependents column:
      3: {
        width: getCellWidth(data, 3, 30),
        wrapWord: true,
      },
    },
  });
}

function renderOutdatedList(
  outdatedMap: Record<string, OutdatedInWorkspace>,
  opts: { long?: boolean | undefined }
): string {
  if (isEmpty.default(outdatedMap)) return '';
  return (
    // biome-ignore lint/style/useTemplate: <explanation>
    sortOutdatedPackages(Object.values(outdatedMap))
      .map((outdatedPkg: SortedOutdatedPackage): string => {
        let info = `${chalk.bold(renderPackageName(outdatedPkg))} ${renderCurrent(outdatedPkg)} ${chalk.grey('=>')} ${renderLatest(outdatedPkg)}`;

        const dependents = dependentPackages(outdatedPkg);

        if (dependents) {
          info += `\n${chalk.bold(
            outdatedPkg.dependentPkgs.length > 1 ? 'Dependents:' : 'Dependent:'
          )} ${dependents}`;
        }

        if (opts.long === true) {
          const details = renderDetails(outdatedPkg);

          if (details) {
            info += `\n${details}`;
          }
        }

        return info;
      })
      .join('\n\n') + '\n'
  );
}

export interface OutdatedPackageInWorkspaceJSONOutput
  extends OutdatedPackageJSONOutput {
  dependentPackages: Array<{ name: string; location: string }>;
}

function renderOutdatedJSON(
  outdatedMap: Record<string, OutdatedInWorkspace>,
  opts: { long?: boolean | undefined }
): string {
  const outdatedPackagesJSON: Record<
    string,
    OutdatedPackageInWorkspaceJSONOutput
  > = sortOutdatedPackages(Object.values(outdatedMap)).reduce(
    (
      acc: Record<string, OutdatedPackageInWorkspaceJSONOutput>,
      outdatedPkg: SortedOutdatedPackage
    ): Record<string, OutdatedPackageInWorkspaceJSONOutput> => {
      acc[outdatedPkg.packageName] = {
        current: outdatedPkg.current,
        latest: outdatedPkg.latestManifest?.version,
        wanted: outdatedPkg.wanted,
        isDeprecated: Boolean(outdatedPkg.latestManifest?.deprecated),
        dependencyType: outdatedPkg.belongsTo,
        dependentPackages: outdatedPkg.dependentPkgs.map(
          ({
            manifest,
            location,
          }: {
            location: string;
            manifest: ProjectManifest;
          }): { name: string; location: string } => {
            return { name: manifest.name, location };
          }
        ),
      };

      const curr = acc[outdatedPkg.packageName];

      if (opts.long === true && typeof curr !== 'undefined') {
        curr.latestManifest = outdatedPkg.latestManifest;
      }

      return acc;
    },
    {}
  );

  return JSON.stringify(outdatedPackagesJSON, null, 2);
}

function dependentPackages({ dependentPkgs }: OutdatedInWorkspace): string {
  return dependentPkgs
    .map(
      ({
        manifest,
        location,
      }: {
        location: string;
        manifest: ProjectManifest;
      }): string => {
        return manifest.name || location;
      }
    )
    .sort()
    .join(', ');
}

interface SortedOutdatedPackage
  extends OutdatedInWorkspace,
    OutdatedWithVersionDiff {}

function sortOutdatedPackages(
  outdatedPackages: readonly OutdatedInWorkspace[]
): SortedOutdatedPackage[] {
  return sortWith.default(
    COMPARATORS,
    outdatedPackages.map(toOutdatedWithVersionDiff)
  );
}
