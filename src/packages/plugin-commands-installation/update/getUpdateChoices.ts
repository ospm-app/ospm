import colorizeSemverDiff from '@pnpm/colorize-semver-diff';
import type { OutdatedPackage } from '../../outdated/outdated.ts';
import semverDiff from '@pnpm/semver-diff';
import { getBorderCharacters, table } from '@zkochan/table';
import { pipe, groupBy, pluck, uniqBy, pickBy, and } from 'ramda';
import isEmpty from 'ramda/src/isEmpty';

export type ChoiceRow = {
  name: string;
  value: string;
  disabled?: boolean | undefined;
};

type ChoiceGroup = Array<{
  name: string;
  message: string;
  choices: ChoiceRow[];
  disabled?: boolean | undefined;
}>;

export function getUpdateChoices(
  outdatedPkgsOfProjects: OutdatedPackage[],
  workspacesEnabled: boolean
): ChoiceGroup {
  if (isEmpty.default(outdatedPkgsOfProjects)) {
    return [];
  }

  function pkgUniqueKey(outdatedPkg: OutdatedPackage): string {
    return JSON.stringify([
      outdatedPkg.packageName,
      outdatedPkg.latestManifest?.version,
      outdatedPkg.current,
    ]);
  }

  const dedupeAndGroupPkgs = pipe(
    uniqBy((outdatedPkg: OutdatedPackage): string => {
      return pkgUniqueKey(outdatedPkg);
    }),
    groupBy((outdatedPkg: OutdatedPackage): string => {
      return outdatedPkg.belongsTo;
    })
  );

  const groupPkgsByType = dedupeAndGroupPkgs(outdatedPkgsOfProjects);

  const headerRow = {
    Package: true,
    Current: true,
    ' ': true,
    Target: true,
    Workspace: workspacesEnabled,
    URL: true,
  };

  // returns only the keys that are true
  const header: string[] = Object.keys(pickBy(and, headerRow));

  const finalChoices: ChoiceGroup = [];

  for (const [depGroup, choiceRows] of Object.entries(groupPkgsByType)) {
    if (typeof choiceRows === 'undefined' || choiceRows.length === 0) {
      continue;
    }

    const rawChoices = choiceRows.map(
      (
        choice: OutdatedPackage
      ): { raw: string[]; name: string; disabled?: boolean | undefined } => {
        return buildPkgChoice(choice, workspacesEnabled);
      }
    );

    // add in a header row for each group
    rawChoices.unshift({
      raw: header,
      name: '',
      disabled: true,
    });

    const renderedTable = alignColumns(pluck('raw', rawChoices)).filter(
      Boolean
    );

    const choices = rawChoices.map(
      (
        outdatedPkg,
        i
      ):
        | {
            name: string;
            value: string;
            disabled: boolean;
            hint: string;
            message?: never;
          }
        | {
            name: string;
            message: string | undefined;
            value: string;
            disabled?: never;
            hint?: never;
          } => {
        if (i === 0) {
          return {
            name: renderedTable[i] ?? '',
            value: '',
            disabled: true,
            hint: '',
          };
        }

        return {
          name: outdatedPkg.name,
          message: renderedTable[i],
          value: outdatedPkg.name,
        };
      }
    );

    // To filter out selected "dependencies" or "devDependencies" in the final output,
    // we rename it here to "[dependencies]" or "[devDependencies]",
    // which will be filtered out in the format function of the prompt.
    finalChoices.push({ name: `[${depGroup}]`, choices, message: depGroup });
  }
  return finalChoices;
}

function buildPkgChoice(
  outdatedPkg: OutdatedPackage,
  workspacesEnabled: boolean
): { raw: string[]; name: string; disabled?: boolean } {
  const sdiff = semverDiff.default(
    outdatedPkg.wanted,
    outdatedPkg.latestManifest?.version ?? ''
  );

  const nextVersion =
    sdiff.change === null
      ? outdatedPkg.latestManifest?.version
      : colorizeSemverDiff.default(
          sdiff as {
            change: semverDiff.SEMVER_CHANGE;
            diff: [string[], string[]];
          }
        );

  const label = outdatedPkg.packageName;

  const lineParts: {
    label: string;
    current?: string | undefined;
    arrow: string;
    nextVersion: string;
    workspace?: string | undefined;
    url: string;
  } = {
    label,
    current: outdatedPkg.current,
    arrow: '❯',
    nextVersion,
    workspace: outdatedPkg.workspace,
    url: getPkgUrl(outdatedPkg),
  };

  if (workspacesEnabled !== true) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lineParts.workspace;
  }

  return {
    raw: Object.values(lineParts).filter(Boolean),
    name: outdatedPkg.packageName,
  };
}

function getPkgUrl(pkg: OutdatedPackage): string {
  if (typeof pkg.latestManifest?.homepage === 'string') {
    return pkg.latestManifest.homepage;
  }

  if (typeof pkg.latestManifest?.repository !== 'string') {
    if (typeof pkg.latestManifest?.repository?.url === 'string') {
      return pkg.latestManifest.repository.url;
    }
  }

  return '';
}

function alignColumns(rows: string[][]): string[] {
  return table(rows, {
    border: getBorderCharacters('void'),
    columnDefault: {
      paddingLeft: 0,
      paddingRight: 1,
      wrapWord: true,
    },
    columns: {
      0: { width: 50, truncate: 100 },
      1: { width: 15, alignment: 'right' },
      3: { width: 15 },
      4: { paddingLeft: 2 },
      5: { paddingLeft: 2 },
    },
    drawHorizontalLine: () => false,
  }).split('\n');
}
