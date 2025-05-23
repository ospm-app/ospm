import fs from 'node:fs';
import path from 'node:path';
import { docsUrl } from '../cli-utils/index.ts';
import { fetchFromDir } from '../directory-fetcher/index.ts';
import { createIndexedPkgImporter } from '../fs.indexed-pkg-importer/index.ts';
import { isEmptyDirOrNothing } from '../fs.is-empty-dir-or-nothing/index.ts';
import { install } from '../plugin-commands-installation/index.ts';
import { FILTERING } from '../common-cli-options-help/index.ts';
import { OspmError } from '../error/index.ts';
import rimraf from '@zkochan/rimraf';
import renderHelp from 'render-help';
import { deployHook } from './deployHook.ts';
import { logger } from '../logger/index.ts';
import type { ModulesDir } from '../types/index.ts';

export const shorthands = install.shorthands;

export function rcOptionsTypes(): Record<string, unknown> {
  return install.rcOptionsTypes();
}

export function cliOptionsTypes(): Record<string, unknown> {
  return install.cliOptionsTypes();
}

export const commandNames = ['deploy'];

export function help(): string {
  return renderHelp({
    description: 'Experimental! Deploy a package from a workspace',
    url: docsUrl('deploy'),
    usages: ['ospm --filter=<deployed project name> deploy <target directory>'],
    descriptionLists: [
      {
        title: 'Options',
        list: [
          {
            description: "Packages in `devDependencies` won't be installed",
            name: '--prod',
            shortAlias: '-P',
          },
          {
            description:
              'Only `devDependencies` are installed regardless of the `NODE_ENV`',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description: '`optionalDependencies` are not installed',
            name: '--no-optional',
          },
        ],
      },
      FILTERING,
    ],
  });
}

export async function handler(
  opts: install.InstallCommandOptions,
  params: string[]
): Promise<void> {
  if (typeof opts.workspaceDir === 'undefined') {
    throw new OspmError(
      'CANNOT_DEPLOY',
      'A deploy is only possible from inside a workspace'
    );
  }

  const selectedDirs = Object.keys(opts.selectedProjectsGraph ?? {});

  if (selectedDirs.length === 0) {
    throw new OspmError(
      'NOTHING_TO_DEPLOY',
      'No project was selected for deployment'
    );
  }

  if (selectedDirs.length > 1) {
    throw new OspmError(
      'CANNOT_DEPLOY_MANY',
      'Cannot deploy more than 1 project'
    );
  }

  if (params.length !== 1) {
    throw new OspmError(
      'INVALID_DEPLOY_TARGET',
      'This command requires one parameter'
    );
  }

  const deployedDir = selectedDirs[0];

  if (typeof deployedDir === 'undefined') {
    throw new OspmError(
      'INVALID_DEPLOY_TARGET',
      'This command requires one parameter'
    );
  }

  const deployDirParam = params[0];

  if (typeof deployDirParam === 'undefined') {
    throw new OspmError(
      'INVALID_DEPLOY_TARGET',
      'This command requires one parameter'
    );
  }

  const deployDir = path.isAbsolute(deployDirParam)
    ? deployDirParam
    : path.join(opts.dir, deployDirParam);

  if (!isEmptyDirOrNothing(deployDir)) {
    if (opts.force !== true) {
      throw new OspmError(
        'DEPLOY_DIR_NOT_EMPTY',
        `Deploy path ${deployDir} is not empty`
      );
    }

    logger.warn({
      message: 'using --force, deleting deploy path',
      prefix: deployDir,
    });
  }

  await rimraf(deployDir);

  await fs.promises.mkdir(deployDir, { recursive: true });

  const includeOnlyPackageFiles = opts.deployAllFiles !== true;

  await copyProject(deployedDir, deployDir, { includeOnlyPackageFiles });

  await install.handler({
    ...opts,
    confirmModulesPurge: false,
    // Deploy doesn't work with dedupePeerDependents=true currently as for deploy
    // we need to select a single project for install, while dedupePeerDependents
    // doesn't work with filters right now.
    // Related issue: https://github.com/pnpm/pnpm/issues/6858
    dedupePeerDependents: false,
    depth: Number.POSITIVE_INFINITY,
    hooks: {
      ...opts.hooks,
      readPackage: [...(opts.hooks?.readPackage ?? []), deployHook],
    },
    frozenLockfile: false,
    preferFrozenLockfile: false,
    saveLockfile: false,
    virtualStoreDir: path.join(deployDir, 'node_modules', '.ospm'),
    modulesDir: path.relative(
      deployedDir,
      path.join(deployDir, 'node_modules')
    ) as ModulesDir,
    rawLocalConfig: {
      ...opts.rawLocalConfig,
      // This is a workaround to prevent frozen install in CI envs.
      'frozen-lockfile': false,
    },
    includeOnlyPackageFiles,
  });
}

async function copyProject(
  src: string,
  dest: string,
  opts: { includeOnlyPackageFiles: boolean }
): Promise<void> {
  const { filesIndex } = await fetchFromDir(src, opts);

  const importPkg = createIndexedPkgImporter('clone-or-copy');

  importPkg(dest, {
    filesMap: filesIndex,
    force: true,
    resolvedFrom: 'local-dir',
  });
}
