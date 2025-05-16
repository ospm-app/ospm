import type { Config } from '../config/index.ts';
import { globalInfo } from '../logger/index.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import { lexCompare } from '../util.lex-comparator/index.ts';
import renderHelp from 'render-help';
import { prompt } from 'enquirer';
import chalk from 'chalk';
import {
  rebuild,
  type RebuildCommandOpts,
} from '../plugin-commands-rebuild/index.ts';
import { updateWorkspaceManifest } from '../workspace.manifest-writer/index.ts';
import { getAutomaticallyIgnoredBuilds } from './getAutomaticallyIgnoredBuilds.ts';
import process from 'node:process';

export type ApproveBuildsCommandOpts = Pick<
  Config,
  | 'modulesDir'
  | 'dir'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
  | 'onlyBuiltDependencies'
  | 'ignoredBuiltDependencies'
>;

export const commandNames = ['approve-builds'];

export function help(): string {
  return renderHelp({
    description: 'Approve dependencies for running scripts during installation',
    usages: [],
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description: 'Approve dependencies of global packages',
            name: '--global',
            shortAlias: '-g',
          },
        ],
      },
    ],
  });
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    global: Boolean,
  };
}

export function rcOptionsTypes(): Record<string, unknown> {
  return {};
}

export async function handler(
  opts: ApproveBuildsCommandOpts & RebuildCommandOpts
): Promise<void> {
  const automaticallyIgnoredBuilds = await getAutomaticallyIgnoredBuilds(opts);

  if (
    typeof automaticallyIgnoredBuilds?.length === 'undefined' ||
    automaticallyIgnoredBuilds.length === 0
  ) {
    globalInfo('There are no packages awaiting approval');

    return;
  }

  const { result } = (await prompt({
    choices: sortUniqueStrings([...automaticallyIgnoredBuilds]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indicator(_state: any, choice: any) {
      return ` ${choice.enabled === true ? '●' : '○'}`;
    },
    message: `Choose which packages to build (Press ${chalk.cyan('<space>')} to select, ${chalk.cyan('<a>')} to toggle all, ${chalk.cyan('<i>')} to invert selection)`,
    name: 'result',
    pointer: '❯',
    result() {
      return this.selected;
    },
    styles: {
      dark: chalk.reset,
      em: chalk.bgBlack.whiteBright,
      success: chalk.reset,
    },
    type: 'multiselect',

    // For Vim users (related: https://github.com/enquirer/enquirer/pull/163)
    j() {
      return this.down();
    },
    k() {
      return this.up();
    },
    cancel() {
      // By default, canceling the prompt via Ctrl+c throws an empty string.
      // The custom cancel function prevents that behavior.
      // Otherwise, ospm CLI would print an error and confuse users.
      // See related issue: https://github.com/enquirer/enquirer/issues/225
      // eslint-disable-next-line n/no-process-exit
      process.exit(0);
    },
  } as any)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const buildPackages: string[] = result.map(
    ({ value }: { value: string }): string => value
  );

  const ignoredPackages = automaticallyIgnoredBuilds.filter(
    (automaticallyIgnoredBuild) => {
      return buildPackages.includes(automaticallyIgnoredBuild) !== true;
    }
  );

  let updatedIgnoredBuiltDependencies: string[] | undefined;

  if (ignoredPackages.length) {
    if (opts.ignoredBuiltDependencies == null) {
      updatedIgnoredBuiltDependencies = sortUniqueStrings(ignoredPackages);
    } else {
      updatedIgnoredBuiltDependencies = sortUniqueStrings([
        ...opts.ignoredBuiltDependencies,
        ...ignoredPackages,
      ]);
    }
  }

  let updatedOnlyBuiltDependencies: string[] | undefined;

  if (buildPackages.length > 0) {
    updatedOnlyBuiltDependencies =
      opts.onlyBuiltDependencies == null
        ? sortUniqueStrings(buildPackages)
        : sortUniqueStrings([...opts.onlyBuiltDependencies, ...buildPackages]);
  }

  if (buildPackages.length) {
    const confirmed = await prompt<{ build: boolean }>({
      type: 'confirm',
      name: 'build',
      message: `The next packages will now be built: ${buildPackages.join(', ')}.
Do you approve?`,
      initial: false,
    });

    if (!confirmed.build) {
      return;
    }
  }

  let { manifest, writeProjectManifest } = await tryReadProjectManifest(
    opts.rootProjectManifestDir
  );

  manifest = manifest ?? {
    name: '',
    version: '',
  };

  if (
    opts.workspaceDir == null ||
    Array.isArray(manifest.ospm?.onlyBuiltDependencies) ||
    typeof manifest.ospm?.ignoredBuiltDependencies !== 'undefined'
  ) {
    manifest.ospm ??= {};

    if (typeof updatedOnlyBuiltDependencies !== 'undefined') {
      manifest.ospm.onlyBuiltDependencies = updatedOnlyBuiltDependencies;
    }

    if (updatedIgnoredBuiltDependencies) {
      manifest.ospm.ignoredBuiltDependencies = updatedIgnoredBuiltDependencies;
    }

    await writeProjectManifest(manifest);
  } else {
    await updateWorkspaceManifest(opts.workspaceDir, {
      onlyBuiltDependencies: updatedOnlyBuiltDependencies,
      ignoredBuiltDependencies: updatedIgnoredBuiltDependencies,
    });
  }

  if (buildPackages.length) {
    return rebuild.handler(
      {
        ...opts,
        onlyBuiltDependencies: updatedOnlyBuiltDependencies ?? [],
      },
      buildPackages
    );
  }
}

function sortUniqueStrings(array: string[]): string[] {
  return Array.from(new Set(array)).sort(lexCompare);
}
