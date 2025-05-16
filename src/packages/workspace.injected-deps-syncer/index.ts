import path from 'node:path';
import { OspmError } from '../error/index.ts';
import { logger as createLogger } from '../logger/index.ts';
import { readModulesManifest } from '../modules-yaml/index.ts';
import normalizePath from 'normalize-path';
import { DirPatcher } from './DirPatcher.ts';
import type { ModulesDir } from '../types/project.ts';

type SkipSyncInjectedDepsMessage = {
  message: string;
  reason: 'no-name' | 'no-injected-deps';
  opts: SyncInjectedDepsOptions;
};

const logger = createLogger<SkipSyncInjectedDepsMessage>(
  'skip-sync-injected-deps'
);

export type SyncInjectedDepsOptions = {
  pkgName: string | undefined;
  pkgRootDir: string;
  workspaceDir: string | undefined;
};

export async function syncInjectedDeps(
  opts: SyncInjectedDepsOptions
): Promise<void> {
  if (typeof opts.pkgName !== 'string') {
    logger.debug({
      reason: 'no-name',
      message: `Skipping sync of ${opts.pkgRootDir} as an injected dependency because, without a name, it cannot be a dependency`,
      opts,
    });
    return;
  }

  if (typeof opts.workspaceDir !== 'string') {
    throw new OspmError(
      'NO_WORKSPACE_DIR',
      'Cannot update injected dependencies without workspace dir'
    );
  }

  const pkgRootDir = path.resolve(opts.workspaceDir, opts.pkgRootDir);

  const modulesDir: ModulesDir = path.resolve(
    opts.workspaceDir,
    'node_modules'
  ) as ModulesDir;

  const modules = await readModulesManifest(modulesDir);

  if (!modules?.injectedDeps) {
    logger.debug({
      reason: 'no-injected-deps',
      message:
        'Skipping sync of injected dependencies because none were detected',
      opts,
    });
    return;
  }

  const injectedDepKey = normalizePath(
    path.relative(opts.workspaceDir, pkgRootDir),
    true
  );

  const targetDirs: string[] | undefined = modules.injectedDeps[injectedDepKey];

  if (!targetDirs || targetDirs.length === 0) {
    logger.debug({
      reason: 'no-injected-deps',
      message: `There are no injected dependencies from ${opts.pkgRootDir}`,
      opts,
    });

    return;
  }

  const patchers = await DirPatcher.fromMultipleTargets(
    pkgRootDir,
    targetDirs.map((targetDir: string): string => {
      return path.resolve(opts.workspaceDir ?? '', targetDir);
    })
  );

  await Promise.all(
    patchers.map((patcher: DirPatcher): Promise<void> => {
      return patcher.apply();
    })
  );
}
