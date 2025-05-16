import path from 'node:path';
import fs from 'node:fs/promises';
import { docsUrl } from '../cli-utils/index.ts';
import { install } from '../plugin-commands-installation/index.ts';
import type { Config } from '../config/index.ts';
import { types as allTypes } from '../config/types.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import { OspmError } from '../error/index.ts';
import type { ProjectManifest, ProjectRootDir } from '../types/index.ts';
import renderHelp from 'render-help';
import { prompt } from 'enquirer';
import pick from 'ramda/src/pick';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default([], allTypes);
}

export function cliOptionsTypes(): Record<string, unknown> {
  return { ...rcOptionsTypes() };
}

export const commandNames = ['patch-remove'];

export function help(): string {
  return renderHelp({
    description: 'Remove existing patch files',
    url: docsUrl('patch-remove'),
    usages: ['ospm patch-remove [pkg...]'],
  });
}

export type PatchRemoveCommandOptions = install.InstallCommandOptions &
  Pick<Config, 'dir' | 'lockfileDir' | 'patchesDir' | 'rootProjectManifest'>;

export async function handler(
  opts: PatchRemoveCommandOptions,
  params: string[]
): Promise<void> {
  let patchesToRemove = params;

  const lockfileDir = ((opts.lockfileDir ?? opts.dir) ||
    process.cwd()) as ProjectRootDir;

  const { writeProjectManifest, manifest } =
    await tryReadProjectManifest(lockfileDir);

  const rootProjectManifest: ProjectManifest | null =
    opts.rootProjectManifest ?? manifest;

  if (rootProjectManifest === null) {
    throw new OspmError(
      'MISSING_PROJECT_MANIFEST',
      'Project manifest not found'
    );
  }

  const patchedDependencies =
    'ospm' in rootProjectManifest &&
    typeof rootProjectManifest === 'object' &&
    typeof rootProjectManifest.ospm === 'object' &&
    'patchedDependencies' in rootProjectManifest.ospm
      ? rootProjectManifest.ospm.patchedDependencies
      : undefined;

  if (!params.length) {
    const allPatches = Object.keys(patchedDependencies ?? {});

    if (allPatches.length) {
      ({ patches: patchesToRemove } = await prompt<{
        patches: string[];
      }>({
        type: 'multiselect',
        name: 'patches',
        message: 'Select the patch to be removed',
        choices: allPatches,
        validate: (value: string): true | string => {
          return value.length === 0 ? 'Select at least one option.' : true;
        },
      }));
    }
  }

  if (!patchesToRemove.length) {
    throw new OspmError(
      'NO_PATCHES_TO_REMOVE',
      'There are no patches that need to be removed'
    );
  }

  const patchesDirs = new Set<string>();

  await Promise.all(
    patchesToRemove.map(async (patch): Promise<void> => {
      if (Object.prototype.hasOwnProperty.call(patchedDependencies, patch)) {
        const dep = patchedDependencies?.[patch];

        if (typeof dep !== 'string') {
          return;
        }

        const patchFile = path.join(lockfileDir, dep);

        patchesDirs.add(path.dirname(patchFile));

        await fs.rm(patchFile, { force: true });

        delete rootProjectManifest.ospm?.patchedDependencies?.[patch];

        if (
          !Object.keys(rootProjectManifest.ospm?.patchedDependencies ?? {})
            .length
        ) {
          // biome-ignore lint/performance/noDelete: <explanation>
          delete rootProjectManifest.ospm?.patchedDependencies;

          if (!Object.keys(rootProjectManifest.ospm ?? {}).length) {
            // biome-ignore lint/performance/noDelete: <explanation>
            delete rootProjectManifest.ospm;
          }
        }
      }
    })
  );

  await Promise.all(
    Array.from(patchesDirs).map(async (dir: string): Promise<void> => {
      try {
        const files = await fs.readdir(dir);

        if (!files.length) {
          await fs.rmdir(dir);
        }
      } catch {}
    })
  );

  await writeProjectManifest(rootProjectManifest);

  if (opts.selectedProjectsGraph?.[lockfileDir]) {
    opts.selectedProjectsGraph[lockfileDir].package.manifest =
      rootProjectManifest;
  }

  if (opts.allProjectsGraph?.[lockfileDir]?.package.manifest) {
    opts.allProjectsGraph[lockfileDir].package.manifest = rootProjectManifest;
  }

  return install.handler(opts);
}
