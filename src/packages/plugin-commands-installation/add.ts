import { docsUrl } from '../cli-utils/index.ts';
import {
  FILTERING,
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { types as allTypes } from '../config/index.ts';
import { PnpmError } from '../error/index.ts';
import { prepareExecutionEnv } from '../plugin-commands-env/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { createProjectManifestWriter } from './createProjectManifestWriter.ts';
import type { InstallCommandOptions } from './install.ts';
import { installDeps } from './installDeps.ts';
import type { ProjectManifest } from '../types/index.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default(
    [
      'cache-dir',
      'child-concurrency',
      'engine-strict',
      'fetch-retries',
      'fetch-retry-factor',
      'fetch-retry-maxtimeout',
      'fetch-retry-mintimeout',
      'fetch-timeout',
      'force',
      'global-bin-dir',
      'global-dir',
      'global-pnpmfile',
      'global',
      'hoist',
      'hoist-pattern',
      'https-proxy',
      'ignore-pnpmfile',
      'ignore-scripts',
      'ignore-workspace-root-check',
      'link-workspace-packages',
      'lockfile-dir',
      'lockfile-directory',
      'lockfile-only',
      'lockfile',
      'modules-dir',
      'network-concurrency',
      'node-linker',
      'noproxy',
      'npm-path',
      'package-import-method',
      'pnpmfile',
      'prefer-offline',
      'production',
      'proxy',
      'public-hoist-pattern',
      'registry',
      'reporter',
      'save-dev',
      'save-exact',
      'save-optional',
      'save-peer',
      'save-prefix',
      'save-prod',
      'save-workspace-protocol',
      'shamefully-flatten',
      'shamefully-hoist',
      'shared-workspace-lockfile',
      'side-effects-cache-readonly',
      'side-effects-cache',
      'store-dir',
      'strict-peer-dependencies',
      'unsafe-perm',
      'offline',
      'only',
      'optional',
      'use-running-store-server',
      'use-store-server',
      'verify-store-integrity',
      'virtual-store-dir',
    ],
    allTypes
  );
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
    'allow-build': [String, Array],
    recursive: Boolean,
    save: Boolean,
    workspace: Boolean,
  };
}

export const commandNames = ['add'];

export function help(): string {
  return renderHelp({
    description: 'Installs a package and any packages that it depends on.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Save package to your `dependencies`. The default behavior',
            name: '--save-prod',
            shortAlias: '-P',
          },
          {
            description: 'Save package to your `devDependencies`',
            name: '--save-dev',
            shortAlias: '-D',
          },
          {
            description: 'Save package to your `optionalDependencies`',
            name: '--save-optional',
            shortAlias: '-O',
          },
          {
            description:
              'Save package to your `peerDependencies` and `devDependencies`',
            name: '--save-peer',
          },
          {
            description: 'Install exact version',
            name: '--[no-]save-exact',
            shortAlias: '-E',
          },
          {
            description:
              'Save packages from the workspace with a "workspace:" protocol. True by default',
            name: '--[no-]save-workspace-protocol',
          },
          {
            description: 'Install as a global package',
            name: '--global',
            shortAlias: '-g',
          },
          {
            description:
              'Run installation recursively in every package found in subdirectories \
or in every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "pnpm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description:
              'Only adds the new dependency if it is found in the workspace',
            name: '--workspace',
          },
          OPTIONS.ignoreScripts,
          OPTIONS.offline,
          OPTIONS.preferOffline,
          OPTIONS.storeDir,
          OPTIONS.virtualStoreDir,
          OPTIONS.globalDir,
          ...UNIVERSAL_OPTIONS,
          {
            description:
              'A list of package names that are allowed to run postinstall scripts during installation',
            name: '--allow-build',
          },
        ],
      },
      FILTERING,
    ],
    url: docsUrl('add'),
    usages: [
      'pnpm add <name>',
      'pnpm add <name>@<tag>',
      'pnpm add <name>@<version>',
      'pnpm add <name>@<version range>',
      'pnpm add <git host>:<git user>/<repo name>',
      'pnpm add <git repo url>',
      'pnpm add <tarball file>',
      'pnpm add <tarball url>',
      'pnpm add <dir>',
    ],
  });
}

export type AddCommandOptions = InstallCommandOptions & {
  allowBuild?: string[] | undefined;
  allowNew?: boolean | undefined;
  ignoreWorkspaceRootCheck?: boolean | undefined;
  save?: boolean | undefined;
  update?: boolean | undefined;
  useBetaCli?: boolean | undefined;
  workspaceRoot?: boolean | undefined;
};

export async function handler(
  opts: AddCommandOptions,
  params: string[]
): Promise<void> {
  if (opts.cliOptions['save'] === false) {
    throw new PnpmError(
      'OPTION_NOT_SUPPORTED',
      'The "add" command currently does not support the no-save option'
    );
  }

  if (params.length === 0) {
    throw new PnpmError(
      'MISSING_PACKAGE_NAME',
      '`pnpm add` requires the package name'
    );
  }

  if (
    opts.recursive !== true &&
    opts.workspaceDir === opts.dir &&
    opts.ignoreWorkspaceRootCheck !== true &&
    opts.workspaceRoot !== true &&
    opts.workspacePackagePatterns &&
    opts.workspacePackagePatterns.length > 1
  ) {
    throw new PnpmError(
      'ADDING_TO_ROOT',
      'Running this command will add the dependency to the workspace root, ' +
        'which might not be what you want - if you really meant it, ' +
        'make it explicit by running this command again with the -w flag (or --workspace-root). ' +
        "If you don't want to see this warning anymore, you may set the ignore-workspace-root-check setting to true."
    );
  }
  if (opts.global === true) {
    if (!opts.bin) {
      throw new PnpmError(
        'NO_GLOBAL_BIN_DIR',
        'Unable to find the global bin directory',
        {
          hint: 'Run "pnpm setup" to create it automatically, or set the global-bin-dir setting, or the PNPM_HOME env variable. The global bin directory should be in the PATH.',
        }
      );
    }

    if (params.includes('pnpm') || params.includes('@pnpm/exe')) {
      throw new PnpmError(
        'GLOBAL_PNPM_INSTALL',
        'Use the "pnpm self-update" command to install or update pnpm'
      );
    }
  }

  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  if (typeof opts.allowBuild !== 'undefined' && opts.allowBuild.length > 0) {
    if (
      typeof opts.rootProjectManifest?.pnpm?.ignoredBuiltDependencies !==
        'undefined' &&
      opts.rootProjectManifest.pnpm.ignoredBuiltDependencies.length
    ) {
      const overlapDependencies =
        opts.rootProjectManifest.pnpm.ignoredBuiltDependencies.filter(
          (dep): boolean => {
            return opts.allowBuild?.includes(dep) === true;
          }
        );

      if (overlapDependencies.length) {
        throw new PnpmError(
          'OVERRIDING_IGNORED_BUILT_DEPENDENCIES',
          `The following dependencies are ignored by the root project, but are allowed to be built by the current command: ${overlapDependencies.join(', ')}`,
          {
            hint: 'If you are sure you want to allow those dependencies to run installation scripts, remove them from the pnpm.ignoredBuiltDependencies list.',
          }
        );
      }
    }

    opts.onlyBuiltDependencies = Array.from(
      new Set([...(opts.onlyBuiltDependencies ?? []), ...opts.allowBuild])
    ).sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });

    const manifest: ProjectManifest = opts.rootProjectManifest ?? {
      name: '',
      version: '0.0.1',
      pnpm: {
        onlyBuiltDependencies: opts.onlyBuiltDependencies,
      },
    };

    manifest.pnpm = manifest.pnpm ??
      opts.rootProjectManifest?.pnpm ?? {
        onlyBuiltDependencies: opts.onlyBuiltDependencies,
      };

    // opts.rootProjectManifest.pnpm = opts.rootProjectManifest.pnpm ?? {};

    manifest.pnpm.onlyBuiltDependencies =
      manifest.pnpm.onlyBuiltDependencies ?? opts.onlyBuiltDependencies;

    const writeProjectManifest = await createProjectManifestWriter(
      opts.rootProjectManifestDir
    );

    await writeProjectManifest(manifest);
  }

  return installDeps(
    {
      ...opts,
      include,
      update: opts.update ?? false,
      includeDirect: include,
      prepareExecutionEnv: prepareExecutionEnv.bind(null, opts),
    },
    params
  );
}
