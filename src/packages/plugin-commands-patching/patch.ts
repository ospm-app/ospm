import fs from 'node:fs';
import path from 'node:path';
import { applyPatchToDir } from '../patching.apply-patch/index.ts';
import { docsUrl } from '../cli-utils/index.ts';
import type { Config } from '../config/index.ts';
import { types as allTypes } from '../config/types.ts';
import type { CreateStoreControllerOptions } from '../store-connection-manager/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import { OspmError } from '../error/index.ts';
import { writePackage } from './writePackage.ts';
import { getEditDirPath } from './getEditDirPath.ts';
import {
  type GetPatchedDependencyResult,
  getPatchedDependency,
} from './getPatchedDependency.ts';
import { writeEditDirState } from './stateFile.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import isWindows from 'is-windows';
import type { ReporterFunction } from '../headless/index.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default([], allTypes);
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
    'edit-dir': String,
    'ignore-existing': Boolean,
  };
}

export const shorthands = {
  d: '--edit-dir',
};

export const commandNames = ['patch'];

export function help(): string {
  return renderHelp({
    description: 'Prepare a package for patching',
    descriptionLists: [
      {
        title: 'Options',
        list: [
          {
            description:
              'The package that needs to be modified will be extracted to this directory',
            name: '--edit-dir',
          },
          {
            description: 'Ignore existing patch files when patching',
            name: '--ignore-existing',
          },
        ],
      },
    ],
    url: docsUrl('patch'),
    usages: ['ospm patch <pkg name>@<version>'],
  });
}

export type PatchCommandOptions = Pick<
  Config,
  | 'dir'
  | 'registries'
  | 'tag'
  | 'storeDir'
  | 'rootProjectManifest'
  | 'lockfileDir'
  | 'modulesDir'
  | 'virtualStoreDir'
  | 'sharedWorkspaceLockfile'
> &
  CreateStoreControllerOptions & {
    editDir?: string | undefined;
    reporter?: ReporterFunction | undefined;
    ignoreExisting?: boolean | undefined;
  };

export async function handler(
  opts: PatchCommandOptions,
  params: string[]
): Promise<string> {
  if (
    typeof opts.editDir === 'string' &&
    fs.existsSync(opts.editDir) &&
    fs.readdirSync(opts.editDir).length > 0
  ) {
    throw new OspmError(
      'PATCH_EDIT_DIR_EXISTS',
      `The target directory already exists: '${opts.editDir}'`
    );
  }

  const first = params[0];

  if (typeof first === 'undefined') {
    throw new OspmError(
      'MISSING_PACKAGE_NAME',
      '`ospm patch` requires the package name'
    );
  }

  const lockfileDir = opts.lockfileDir;

  const patchedDep = await getPatchedDependency(first, {
    lockfileDir,
    modulesDir: opts.modulesDir,
    virtualStoreDir: opts.virtualStoreDir,
  });

  const modulesDir = path.join(lockfileDir, opts.modulesDir ?? 'node_modules');

  const editDir =
    typeof opts.editDir === 'string'
      ? path.resolve(opts.dir, opts.editDir)
      : getEditDirPath(first, patchedDep, { modulesDir });

  if (fs.existsSync(editDir) && fs.readdirSync(editDir).length !== 0) {
    throw new OspmError(
      'EDIT_DIR_NOT_EMPTY',
      `The directory ${editDir} is not empty`,
      {
        hint: 'Either run `ospm patch-commit` to commit or delete it then run `ospm patch` to recreate it',
      }
    );
  }

  await writePackage(patchedDep, editDir, opts);

  writeEditDirState({
    editDir,
    modulesDir: path.join(opts.dir, opts.modulesDir ?? 'node_modules'),
    patchedPkg: first,
    applyToAll: patchedDep.applyToAll,
  });

  if (opts.ignoreExisting !== true) {
    let rootProjectManifest = opts.rootProjectManifest;

    if (opts.sharedWorkspaceLockfile !== true) {
      const { manifest } = await tryReadProjectManifest(lockfileDir);

      if (manifest) {
        rootProjectManifest = manifest;
      }
    }

    if (rootProjectManifest?.ospm?.patchedDependencies) {
      tryPatchWithExistingPatchFile({
        allowFailure: patchedDep.applyToAll,
        patchedDep,
        patchedDir: editDir,
        patchedDependencies: rootProjectManifest.ospm.patchedDependencies,
        lockfileDir,
      });
    }
  }

  const quote = isWindows() ? '"' : "'";

  return `Patch: You can now edit the package at:

  ${terminalLink(chalk.blue(editDir), `file://${editDir}`)}

To commit your changes, run:

  ${chalk.green(`ospm patch-commit ${quote}${editDir}${quote}`)}

`;
}

function tryPatchWithExistingPatchFile({
  allowFailure,
  patchedDep: { applyToAll, alias, pref },
  patchedDir,
  patchedDependencies,
  lockfileDir,
}: {
  allowFailure: boolean;
  patchedDep: GetPatchedDependencyResult;
  patchedDir: string;
  patchedDependencies: Record<string, string>;
  lockfileDir: string;
}): void {
  if (typeof alias !== 'string') return;

  let existingPatchFile: string | undefined;

  if (typeof pref === 'string') {
    existingPatchFile = patchedDependencies[`${alias}@${pref}`];
  }

  if (typeof existingPatchFile === 'undefined' && applyToAll) {
    existingPatchFile = patchedDependencies[alias];
  }

  if (typeof existingPatchFile === 'undefined') {
    return;
  }

  const existingPatchFilePath = path.resolve(lockfileDir, existingPatchFile);

  if (fs.existsSync(existingPatchFilePath) !== true) {
    throw new OspmError(
      'PATCH_FILE_NOT_FOUND',
      `Unable to find patch file ${existingPatchFilePath}`
    );
  }

  applyPatchToDir({
    patchedDir,
    patchFilePath: existingPatchFilePath,
    allowFailure,
  });
}
