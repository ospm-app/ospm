import path from 'node:path';
import { readModulesManifest } from '../modules-yaml/index.ts';
import type { IgnoredBuildsCommandOpts } from './ignoredBuilds.ts';
import type { LockFileDir, ModulesDir } from '../types/project.ts';

export async function getAutomaticallyIgnoredBuilds(
  opts: IgnoredBuildsCommandOpts
): Promise<null | string[]> {
  const modulesManifest = await readModulesManifest(
    opts.modulesDir ??
      (path.join(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        opts.lockfileDir ?? (opts.dir as LockFileDir),
        'node_modules'
      ) as ModulesDir)
  );

  if (modulesManifest == null) {
    return null;
  }

  return modulesManifest.ignoredBuilds ?? [];
}
