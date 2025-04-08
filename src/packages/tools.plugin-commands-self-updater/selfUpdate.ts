import path from 'node:path';
import { docsUrl } from '../cli-utils/index.ts';
import { packageManager, isExecutedByCorepack } from '../cli-meta/index.ts';
import { createResolver } from '../client/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import { type Config, types as allTypes } from '../config/index.ts';
import { PnpmError } from '../error/index.ts';
import { globalWarn } from '../logger/index.ts';
import { readProjectManifest } from '../read-project-manifest/index.ts';
import { linkBins } from '../link-bins/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { installPnpmToTools } from './installPnpmToTools.ts';
import type { ModulesDir } from '../types/project.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default([], allTypes);
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
  };
}

export const commandNames = ['self-update'];

export function help(): string {
  return renderHelp({
    description: 'Updates pnpm to the latest version (or the one specified)',
    descriptionLists: [],
    url: docsUrl('self-update'),
    usages: [
      'pnpm self-update',
      'pnpm self-update 9',
      'pnpm self-update next-10',
      'pnpm self-update 9.10.0',
    ],
  });
}

export type SelfUpdateCommandOptions = Pick<
  Config,
  | 'cacheDir'
  | 'dir'
  | 'lockfileDir'
  | 'managePackageManagerVersions'
  | 'modulesDir'
  | 'pnpmHomeDir'
  | 'rawConfig'
  | 'registries'
  | 'rootProjectManifestDir'
  | 'wantedPackageManager'
>;

export async function handler(
  opts: SelfUpdateCommandOptions,
  params: string[]
): Promise<undefined | string> {
  if (isExecutedByCorepack()) {
    throw new PnpmError(
      'CANT_SELF_UPDATE_IN_COREPACK',
      'You should update pnpm with corepack'
    );
  }

  const { resolve } = createResolver({ ...opts, authConfig: opts.rawConfig });

  const pkgName = 'pnpm';

  const pref = params[0] ?? 'latest';

  const resolution = await resolve(
    { alias: pkgName, pref },
    {
      lockfileDir: opts.lockfileDir, // ?? opts.dir,
      preferredVersions: {},
      projectDir: opts.dir,
      registry: pickRegistryForPackage(opts.registries, pkgName, pref),
    }
  );

  if (typeof resolution.manifest === 'undefined') {
    throw new PnpmError(
      'CANNOT_RESOLVE_PNPM',
      `Cannot find "${pref}" version of pnpm`
    );
  }

  if (resolution.manifest.version === packageManager.version) {
    return `The currently active ${packageManager.name} v${packageManager.version} is already "${pref}" and doesn't need an update`;
  }

  if (
    opts.wantedPackageManager?.name === packageManager.name &&
    opts.managePackageManagerVersions
  ) {
    const { manifest, writeProjectManifest } = await readProjectManifest(
      opts.rootProjectManifestDir
    );

    manifest.packageManager = `pnpm@${resolution.manifest.version}`;

    await writeProjectManifest(manifest);

    return `The current project has been updated to use pnpm v${resolution.manifest.version}`;
  }

  const { baseDir, alreadyExisted } = await installPnpmToTools(
    resolution.manifest.version,
    opts
  );

  await linkBins(
    path.join(baseDir, opts.modulesDir ?? 'node_modules') as ModulesDir,
    opts.pnpmHomeDir,
    {
      warn: globalWarn,
    }
  );

  return alreadyExisted
    ? `The ${pref} version, v${resolution.manifest.version}, is already present on the system. It was activated by linking it from ${baseDir}.`
    : undefined;
}
