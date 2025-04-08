import path from 'node:path';
import type { PackageNode } from '../reviewing.dependencies-hierarchy/index.ts';
import { DEPENDENCIES_FIELDS, type DependenciesField } from '../types/index.ts';
import archy from 'archy';
import chalk from 'chalk';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import cliColumns from 'cli-columns';
import sortBy from 'ramda/src/sortBy';
import ramdaPath from 'ramda/src/path';
import type { Ord } from 'ramda';
import { getPkgInfo } from './getPkgInfo.ts';
import type { PackageDependencyHierarchy } from './types.ts';

const sortPackages = sortBy.default(
  ramdaPath.default(['name']) as (pkg: PackageNode) => Ord
);

const DEV_DEP_ONLY_CLR = chalk.yellow;

const PROD_DEP_CLR = (s: string): string => s; // just use the default color

const OPTIONAL_DEP_CLR = chalk.blue;

const NOT_SAVED_DEP_CLR = chalk.red;

const LEGEND = `Legend: ${PROD_DEP_CLR('production dependency')}, ${OPTIONAL_DEP_CLR('optional only')}, ${DEV_DEP_ONLY_CLR('dev only')}\n\n`;

export type RenderTreeOptions = {
  alwaysPrintRootPackage?: boolean | undefined;
  depth?: number | undefined;
  long?: boolean | undefined;
  search: boolean;
  showExtraneous: boolean;
};

export async function renderTree(
  packages: PackageDependencyHierarchy[],
  opts: RenderTreeOptions
): Promise<string> {
  const output = (
    await Promise.all(
      packages.map(async (pkg) => renderTreeForPackage(pkg, opts))
    )
  )
    .filter(Boolean)
    .join('\n\n');
  return `${typeof opts.depth === 'number' && opts.depth > -1 && output ? LEGEND : ''}${output}`;
}

async function renderTreeForPackage(
  pkg: PackageDependencyHierarchy,
  opts: RenderTreeOptions
): Promise<string> {
  if (
    opts.alwaysPrintRootPackage !== true &&
    typeof pkg.dependencies?.length === 'undefined' &&
    typeof pkg.devDependencies?.length === 'undefined' &&
    typeof pkg.optionalDependencies?.length === 'undefined' &&
    (!opts.showExtraneous ||
      typeof pkg.unsavedDependencies?.length === 'undefined')
  ) {
    return '';
  }

  let label = '';

  if (typeof pkg.name === 'string') {
    label += pkg.name;

    if (typeof pkg.version === 'string') {
      label += `@${pkg.version}`;
    }

    label += ' ';
  }

  label += pkg.path;

  if (pkg.private === true) {
    label += ' (PRIVATE)';
  }

  const useColumns = opts.depth === 0 && opts.long !== true && !opts.search;

  const dependenciesFields: Array<DependenciesField | 'unsavedDependencies'> = [
    ...DEPENDENCIES_FIELDS.sort(),
  ];

  if (opts.showExtraneous) {
    dependenciesFields.push('unsavedDependencies');
  }

  const output = (
    await Promise.all(
      dependenciesFields.map(async (dependenciesField) => {
        if (typeof pkg[dependenciesField]?.length !== 'undefined') {
          const depsLabel = chalk.cyanBright(
            dependenciesField === 'unsavedDependencies'
              ? 'not saved (you should add these dependencies to package.json if you need them):'
              : `${dependenciesField}:`
          );

          let output = `${depsLabel}\n`;

          const gPkgColor =
            dependenciesField === 'unsavedDependencies'
              ? () => NOT_SAVED_DEP_CLR
              : getPkgColor;

          if (useColumns && pkg[dependenciesField].length > 10) {
            output += `${cliColumns(
              pkg[dependenciesField].map(printLabel.bind(printLabel, gPkgColor))
            )}\n`;

            return output;
          }

          const data = await toArchyTree(gPkgColor, pkg[dependenciesField], {
            long: opts.long,
            modules: path.join(pkg.path, 'node_modules'),
          });

          for (const d of data) {
            output += archy(d);
          }

          return output;
        }

        return null;
      })
    )
  )
    .filter(Boolean)
    .join('\n');

  return `${chalk.bold.underline(label)}\n\n${output}`.replace(/(\n)+$/, '');
}

type GetPkgColor = (node: PackageNode) => (s: string) => string;

export async function toArchyTree(
  getPkgColor: GetPkgColor,
  entryNodes: PackageNode[],
  opts: {
    long?: boolean | undefined;
    modules: string;
  }
): Promise<archy.Data[]> {
  return Promise.all(
    sortPackages(entryNodes).map(async (node) => {
      const nodes = await toArchyTree(
        getPkgColor,
        node.dependencies ?? [],
        opts
      );

      if (opts.long === true) {
        const pkg = await getPkgInfo(node);

        const labelLines = [printLabel(getPkgColor, node), pkg.description];

        if (typeof pkg.repository === 'string') {
          labelLines.push(pkg.repository);
        }

        if (typeof pkg.homepage === 'string') {
          labelLines.push(pkg.homepage);
        }

        if (typeof pkg.path === 'string') {
          labelLines.push(pkg.path);
        }

        return {
          label: labelLines.join('\n'),
          nodes,
        };
      }

      return {
        label: printLabel(getPkgColor, node),
        nodes,
      };
    })
  );
}

function printLabel(getPkgColor: GetPkgColor, node: PackageNode): string {
  const color = getPkgColor(node);

  let txt = `${color(node.name)} ${chalk.gray(node.version)}`;

  if (node.isPeer) {
    txt += ' peer';
  }

  if (node.isSkipped) {
    txt += ' skipped';
  }

  return node.searched ? chalk.bold(txt) : txt;
}

function getPkgColor(node: PackageNode): (text: string) => string {
  if (node.dev === true) {
    return DEV_DEP_ONLY_CLR;
  }

  if (node.optional) {
    return OPTIONAL_DEP_CLR;
  }

  return PROD_DEP_CLR;
}
