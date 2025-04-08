import { promises as fs } from 'node:fs';
import util from 'node:util';
import path from 'node:path';
// import { getLockfileImporterId } from '../lockfile.fs/index.ts';
import { type Modules, readModulesManifest } from '../modules-yaml/index.ts';
import { normalizeRegistries } from '../normalize-registries/index.ts';
import type {
  DepPath,
  DependenciesField,
  HoistedDependencies,
  Registries,
  ProjectRootDir,
  ProjectRootDirRealPath,
  ProjectId,
  ModulesDir,
  GlobalPkgDir,
  LockFileDir,
  WorkspaceDir,
} from '../types/index.ts';
import realpathMissing from 'realpath-missing';
import type { HookOptions, ProjectOptions } from '../get-context/index.ts';
import { getLockfileImporterId } from '../lockfile.fs/index.ts';

export async function readProjectsContext(
  projects: Array<ProjectOptions & HookOptions & { binsDir: string }>,
  opts: {
    lockfileDir?: LockFileDir | undefined;
    modulesDir: string;
  }
): Promise<{
  currentHoistPattern?: string[] | undefined;
  currentPublicHoistPattern?: string[] | undefined;
  hoist?: boolean | undefined;
  hoistedDependencies: HoistedDependencies;
  projects: Array<ProjectOptions & HookOptions & { binsDir: string }>;
  include: Record<DependenciesField, boolean>;
  modules: Modules | null;
  pendingBuilds: string[];
  registries: Registries | null | undefined;
  rootModulesDir: ModulesDir;
  skipped: Set<DepPath>;
  virtualStoreDirMaxLength?: number | undefined;
}> {
  const relativeModulesDir = opts.modulesDir || 'node_modules';

  const rootModulesDir: ModulesDir = (await realpathMissing(
    path.join(opts.lockfileDir ?? '', relativeModulesDir)
  )) as ModulesDir;

  const modules = await readModulesManifest(rootModulesDir);

  return {
    currentHoistPattern: modules?.hoistPattern,
    currentPublicHoistPattern: modules?.publicHoistPattern,
    hoist: modules == null ? undefined : Boolean(modules.hoistPattern),
    hoistedDependencies: modules?.hoistedDependencies ?? {},
    include: modules?.included ?? {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    modules,
    pendingBuilds: modules?.pendingBuilds ?? [],
    projects: await Promise.all(
      projects.map(
        async (
          project: ProjectOptions & HookOptions & { binsDir: string }
        ): Promise<
          ProjectOptions &
            HookOptions & {
              binsDir: string;
              id: ProjectId;
            }
        > => {
          const modulesDir: ModulesDir = (await realpathMissing(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            path.join(project.rootDir, project.modulesDir ?? relativeModulesDir)
          )) as ModulesDir;

          const importerId = getLockfileImporterId(
            opts.lockfileDir ?? '',
            project.rootDir
          );

          return {
            ...project,
            binsDir:
              project.binsDir ||
              path.join(project.rootDir, relativeModulesDir, '.bin'),
            id: importerId,
            modulesDir,
            rootDirRealPath:
              typeof project.rootDirRealPath === 'string'
                ? project.rootDirRealPath
                : await realpath(project.rootDir),
          };
        }
      )
    ),
    registries:
      modules?.registries != null
        ? normalizeRegistries(modules.registries)
        : undefined,
    rootModulesDir,
    skipped: new Set((modules?.skipped ?? []) as DepPath[]),
    virtualStoreDirMaxLength: modules?.virtualStoreDirMaxLength,
  };
}

async function realpath(
  path:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir
): Promise<ProjectRootDirRealPath> {
  try {
    return (await fs.realpath(path)) as ProjectRootDirRealPath;
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return path as unknown as ProjectRootDirRealPath;
    }
    throw err;
  }
}
