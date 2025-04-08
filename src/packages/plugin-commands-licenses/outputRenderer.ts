import { TABLE_OPTIONS } from '../cli-utils/index.ts';
import type { LicensePackage } from '../license-scanner/index.ts';
import chalk from 'chalk';
import { table } from '@zkochan/table';
import { groupBy, sortWith, omit, pick } from 'ramda';
import semver from 'semver';
import type { LicensesCommandResult } from './LicensesCommandResult.ts';

function sortLicensesPackages(
  licensePackages: readonly LicensePackage[]
): LicensePackage[] {
  return sortWith(
    [
      (o1: LicensePackage, o2: LicensePackage) =>
        o1.license.localeCompare(o2.license),
    ],
    licensePackages
  );
}

function renderPackageName({
  belongsTo,
  name: packageName,
}: LicensePackage): string {
  switch (belongsTo) {
    case 'devDependencies':
      return `${packageName} ${chalk.dim('(dev)')}`;
    case 'optionalDependencies':
      return `${packageName} ${chalk.dim('(optional)')}`;
    default:
      return packageName as string;
  }
}

function renderPackageLicense({ license }: LicensePackage): string {
  const output = license || 'Unknown';
  return output as string;
}

function renderDetails(licensePackage: LicensePackage): string {
  const outputs = [];

  if (typeof licensePackage.author !== 'undefined') {
    outputs.push(licensePackage.author);
  }
  if (typeof licensePackage.description !== 'undefined') {
    outputs.push(licensePackage.description);
  }
  if (typeof licensePackage.homepage !== 'undefined') {
    outputs.push(licensePackage.homepage);
  }
  return outputs.join('\n');
}

export function renderLicenses(
  licensesMap: LicensePackage[],
  opts: { long?: boolean | undefined; json?: boolean | undefined }
): LicensesCommandResult {
  if (opts.json === true) {
    return { output: renderLicensesJson(licensesMap), exitCode: 0 };
  }

  return { output: renderLicensesTable(licensesMap, opts), exitCode: 0 };
}

function renderLicensesJson(
  licensePackages: readonly LicensePackage[]
): string {
  const data = licensePackages.map(
    (
      item: LicensePackage
    ): Pick<
      LicensePackage,
      | 'author'
      | 'description'
      | 'homepage'
      | 'name'
      | 'version'
      | 'path'
      | 'license'
    > => {
      return pick(
        [
          'name',
          'version',
          'path',
          'license',
          'author',
          'homepage',
          'description',
        ],
        item
      );
    }
  );

  const output: Record<string, LicensePackageJson[]> = {};

  const groupedByLicense = groupBy((item) => item.license, data);

  for (const license in groupedByLicense) {
    const outputList: LicensePackageJson[] = [];

    const groupedByName = groupBy(
      (
        item: Pick<
          LicensePackage,
          | 'author'
          | 'description'
          | 'homepage'
          | 'name'
          | 'version'
          | 'path'
          | 'license'
        >
      ): string => {
        return item.name;
      },
      groupedByLicense[license] ?? []
    );

    for (const inputList of Object.values(groupedByName)) {
      if (inputList == null) continue;

      inputList.sort((a, b) => semver.compare(a.version, b.version));

      const versions = inputList.map((item) => item.version);

      const paths = inputList.map((item) => item.path ?? null);

      const lastInputItem = inputList.at(-1); // last item is chosen for its latest information

      if (typeof lastInputItem !== 'undefined') {
        const outputItem: LicensePackageJson = {
          name: lastInputItem.name,
          versions,
          paths,
          ...omit(['name', 'version', 'path'], lastInputItem),
        };

        outputList.push(outputItem);
      }
    }

    output[license] = outputList;
  }

  return JSON.stringify(output, null, 2);
}

export type LicensePackageJson = {
  name: string;
  versions: string[];
  license: string;
  author?: string | undefined;
  homepage?: string | undefined;
  paths: Array<string | null>;
};

function renderLicensesTable(
  licensePackages: readonly LicensePackage[],
  opts: { long?: boolean | undefined }
): string {
  const columnNames = ['Package', 'License'];

  const columnFns = [renderPackageName, renderPackageLicense];

  if (opts.long === true) {
    columnNames.push('Details');
    columnFns.push(renderDetails);
  }

  // Avoid the overhead of allocating a new array caused by calling `array.map()`
  for (let i = 0; i < columnNames.length; i++) {
    columnNames[i] = chalk.blueBright(columnNames[i]);
  }

  const data = [
    columnNames,
    ...deduplicateLicensesPackages(sortLicensesPackages(licensePackages)).map(
      (licensePkg: LicensePackage): string[] => {
        return columnFns.map(
          (fn: ({ belongsTo, name }: LicensePackage) => string): string => {
            return fn(licensePkg);
          }
        );
      }
    ),
  ];

  let detailsColumnMaxWidth = 40;
  let packageColumnMaxWidth = 0;
  let licenseColumnMaxWidth = 0;

  if (opts.long === true) {
    // Use the package link to determine the width of the details column
    detailsColumnMaxWidth = licensePackages.reduce(
      (max: number, pkg: LicensePackage): number => {
        return Math.max(max, pkg.homepage?.length ?? 0);
      },
      0
    );

    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      if (typeof row === 'undefined') {
        continue;
      }

      const detailsLineCount = row[2]?.split('\n').length;

      if (typeof detailsLineCount === 'undefined') {
        continue;
      }

      const linesNumber = Math.max(0, detailsLineCount - 1);

      row[0] += '\n '.repeat(linesNumber); // Add extra spaces to the package column

      row[1] += '\n '.repeat(linesNumber); // Add extra spaces to the license column

      packageColumnMaxWidth = Math.max(
        packageColumnMaxWidth,
        row[0]?.length ?? 0
      );

      licenseColumnMaxWidth = Math.max(
        licenseColumnMaxWidth,
        row[1]?.length ?? 0
      );
    }

    const remainColumnWidth =
      process.stdout.columns -
      packageColumnMaxWidth -
      licenseColumnMaxWidth -
      20;

    if (detailsColumnMaxWidth > remainColumnWidth) {
      detailsColumnMaxWidth = remainColumnWidth;
    }

    detailsColumnMaxWidth = Math.max(detailsColumnMaxWidth, 40);
  }

  try {
    return table(data, {
      ...TABLE_OPTIONS,
      columns: {
        ...TABLE_OPTIONS.columns,
        2: {
          width: detailsColumnMaxWidth,
          wrapWord: true,
        },
      },
    });
  } catch {
    // Fallback to the default table if the details column width is too large, avoiding the error
    return table(data, TABLE_OPTIONS);
  }
}

function deduplicateLicensesPackages(
  licensePackages: LicensePackage[]
): LicensePackage[] {
  const result: LicensePackage[] = [];

  function rowEqual(a: LicensePackage, b: LicensePackage): boolean {
    return a.name === b.name && a.license === b.license;
  }

  function hasRow(row: LicensePackage): boolean {
    return result.some((x) => rowEqual(row, x));
  }

  for (const row of licensePackages.reverse()) {
    // reverse + unshift to prioritize latest package description
    if (!hasRow(row)) result.unshift(row);
  }

  return result;
}
