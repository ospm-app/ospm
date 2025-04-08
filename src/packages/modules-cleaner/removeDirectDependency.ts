import path from 'node:path';
import { promises as fs } from 'node:fs';
import { rootLogger } from '../core-loggers/index.ts';
import { removeBin, removeBinsOfDependency } from '../remove-bins/index.ts';
import type {
  DependenciesField,
  GlobalPkgDir,
  LockFileDir,
  ModulesDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import rimraf from '@zkochan/rimraf';

export async function removeDirectDependency(
  dependency: {
    dependenciesField?: DependenciesField | undefined;
    name: string;
  },
  opts: {
    binsDir: string;
    dryRun?: boolean | undefined;
    modulesDir: ModulesDir;
    muteLogs?: boolean | undefined;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  }
): Promise<void> {
  const dependencyDir = path.join(opts.modulesDir, dependency.name);

  const results = await Promise.all([
    removeBinsOfDependency(dependencyDir, opts),
    opts.dryRun !== true && (removeBin(dependencyDir) as any), // eslint-disable-line @typescript-eslint/no-explicit-any
  ]);

  await removeIfEmpty(opts.binsDir);

  const uninstalledPkg = results[0];

  if (opts.muteLogs !== true) {
    rootLogger.debug({
      prefix: opts.rootDir,
      removed: {
        dependencyType:
          dependency.dependenciesField === 'devDependencies'
            ? 'dev'
            : dependency.dependenciesField === 'optionalDependencies'
              ? 'optional'
              : dependency.dependenciesField === 'dependencies'
                ? 'prod'
                : undefined,
        name: dependency.name,
        version: uninstalledPkg?.version,
      },
    });
  }
}

export async function removeIfEmpty(dir: string): Promise<void> {
  if (await dirIsEmpty(dir)) {
    await rimraf(dir);
  }
}

async function dirIsEmpty(dir: string): Promise<boolean> {
  try {
    const fileNames = await fs.readdir(dir);

    return fileNames.length === 0;
  } catch {
    return false;
  }
}
