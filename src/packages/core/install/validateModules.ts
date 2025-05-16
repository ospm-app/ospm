import { promises as fs } from 'node:fs';
import path from 'node:path';
import { OspmError } from '../../error/index.ts';
import { logger } from '../../logger/index.ts';
import type {
  IncludedDependencies,
  Modules,
} from '../../modules-yaml/index.ts';
import {
  DEPENDENCIES_FIELDS,
  type Registries,
  type ProjectRootDir,
  type GlobalPkgDir,
  type ProjectRootDirRealPath,
  type LockFileDir,
  type WorkspaceDir,
  type ModulesDir,
} from '../../types/index.ts';
import rimraf from '@zkochan/rimraf';
import enquirer from 'enquirer';
import equals from 'ramda/src/equals';
import { checkCompatibility } from './checkCompatibility/index.ts';

type ImporterToPurge = {
  modulesDir: ModulesDir;
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir;
};

export async function validateModules(
  modules: Modules,
  projects: Array<{
    modulesDir: ModulesDir;
    id: string;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
  }>,
  opts: {
    currentHoistPattern?: string[] | undefined;
    currentPublicHoistPattern?: string[] | undefined;
    forceNewModules: boolean;
    include?: IncludedDependencies;
    lockfileDir:
      | WorkspaceDir
      | LockFileDir
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir;
    modulesDir: ModulesDir;
    registries: Registries;
    storeDir: string;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    confirmModulesPurge?: boolean | undefined;

    hoistPattern?: string[] | undefined;
    forceHoistPattern?: boolean | undefined;

    publicHoistPattern?: string[] | undefined;
    forcePublicHoistPattern?: boolean | undefined;
    global?: boolean | undefined;
  }
): Promise<{ purged: boolean }> {
  const rootProject = projects.find(({ id }) => id === '.');

  if (opts.virtualStoreDirMaxLength !== modules.virtualStoreDirMaxLength) {
    if (opts.forceNewModules && rootProject != null) {
      await purgeModulesDirsOfImporter(opts, rootProject);

      return { purged: true };
    }
    throw new OspmError(
      'VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF',
      'This modules directory was created using a different virtual-store-dir-max-length value.' +
        ' Run "ospm install" to recreate the modules directory.'
    );
  }

  if (
    opts.forcePublicHoistPattern === true &&
    !equals.default(modules.publicHoistPattern, opts.publicHoistPattern)
  ) {
    if (opts.forceNewModules && rootProject != null) {
      await purgeModulesDirsOfImporter(opts, rootProject);

      return { purged: true };
    }

    throw new OspmError(
      'PUBLIC_HOIST_PATTERN_DIFF',
      'This modules directory was created using a different public-hoist-pattern value.' +
        ' Run "ospm install" to recreate the modules directory.'
    );
  }

  const importersToPurge: ImporterToPurge[] = [];

  if (opts.forceHoistPattern === true && typeof rootProject !== 'undefined') {
    try {
      if (
        !equals.default(
          opts.currentHoistPattern,
          opts.hoistPattern || undefined
        )
      ) {
        throw new OspmError(
          'HOIST_PATTERN_DIFF',
          'This modules directory was created using a different hoist-pattern value.' +
            ' Run "ospm install" to recreate the modules directory.'
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!opts.forceNewModules) {
        throw err;
      }

      importersToPurge.push(rootProject);
    }
  }

  for (const project of projects) {
    try {
      checkCompatibility(modules, {
        modulesDir: project.modulesDir,
        storeDir: opts.storeDir,
        virtualStoreDir: opts.virtualStoreDir,
      });

      if (
        opts.lockfileDir !== project.rootDir &&
        opts.include != null &&
        typeof modules.included !== 'undefined'
      ) {
        for (const depsField of DEPENDENCIES_FIELDS) {
          if (opts.include[depsField] !== modules.included[depsField]) {
            throw new OspmError(
              'INCLUDED_DEPS_CONFLICT',
              `modules directory (at "${opts.lockfileDir}") was installed with ${stringifyIncludedDeps(modules.included)}. ` +
                `Current install wants ${stringifyIncludedDeps(opts.include)}.`
            );
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!opts.forceNewModules) {
        throw err;
      }

      importersToPurge.push(project);
    }
  }

  if (importersToPurge.length > 0 && rootProject == null) {
    importersToPurge.push({
      modulesDir: path.join(opts.lockfileDir, opts.modulesDir) as ModulesDir,
      rootDir: opts.lockfileDir,
    });
  }

  const purged = importersToPurge.length > 0;

  if (purged) {
    await purgeModulesDirsOfImporters(opts, importersToPurge);
  }

  return { purged };
}

async function purgeModulesDirsOfImporter(
  opts: {
    confirmModulesPurge?: boolean | undefined;
    virtualStoreDir: string;
  },
  importer: ImporterToPurge
): Promise<void> {
  return purgeModulesDirsOfImporters(opts, [importer]);
}

async function purgeModulesDirsOfImporters(
  opts: {
    confirmModulesPurge?: boolean | undefined;
    virtualStoreDir: string;
  },
  importers: ImporterToPurge[]
): Promise<void> {
  if (opts.confirmModulesPurge ?? true) {
    const confirmed = await enquirer.prompt<{ question: boolean }>({
      type: 'confirm',
      name: 'question',
      message:
        importers.length === 1
          ? `The modules directory at "${importers[0]?.modulesDir ?? ''}" will be removed and reinstalled from scratch. Proceed?`
          : 'The modules directories will be removed and reinstalled from scratch. Proceed?',
      initial: true,
    });

    if (!confirmed.question) {
      throw new OspmError(
        'ABORTED_REMOVE_MODULES_DIR',
        'Aborted removal of modules directory'
      );
    }
  }

  await Promise.all(
    importers.map(async (importer: ImporterToPurge): Promise<void> => {
      logger.info({
        message: `Recreating ${importer.modulesDir}`,
        prefix: importer.rootDir,
      });

      try {
        // We don't remove the actual modules directory, just the contents of it.
        // 1. we will need the directory anyway.
        // 2. in some setups, ospm won't even have permission to remove the modules directory.
        await removeContentsOfDir(importer.modulesDir, opts.virtualStoreDir);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    })
  );
}

async function removeContentsOfDir(
  dir: string,
  virtualStoreDir: string
): Promise<void> {
  const items = await fs.readdir(dir);
  await Promise.all(
    items.map(async (item) => {
      // The non-ospm related hidden files are kept
      if (
        item.startsWith('.') &&
        item !== '.bin' &&
        item !== '.modules.yaml' &&
        !dirsAreEqual(path.join(dir, item), virtualStoreDir)
      ) {
        return;
      }
      await rimraf(path.join(dir, item));
    })
  );
}

function dirsAreEqual(dir1: string, dir2: string): boolean {
  return path.relative(dir1, dir2) === '';
}

function stringifyIncludedDeps(included: IncludedDependencies): string {
  return DEPENDENCIES_FIELDS.filter((depsField) => included[depsField]).join(
    ', '
  );
}
