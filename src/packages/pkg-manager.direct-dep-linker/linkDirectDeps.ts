import fs from 'node:fs';
import path from 'node:path';
import { rootLogger } from '../core-loggers/index.ts';
import {
  symlinkDependency,
  symlinkDirectRootDependency,
} from '../symlink-dependency/index.ts';
import omit from 'ramda/src/omit';
import { readModulesDir } from '../read-modules-dir/index.ts';
import rimraf from '@zkochan/rimraf';
import resolveLinkTarget from 'resolve-link-target';
import type { ModulesDir } from '../types/project.ts';

export type LinkedDirectDep = {
  alias: string;
  name: string;
  version: string;
  dir: string;
  id: string;
  dependencyType: 'prod' | 'dev' | 'optional';
  isExternalLink: boolean;
  latest?: string | undefined;
};

export type ProjectToLink = {
  dir: string;
  modulesDir: ModulesDir;
  dependencies: LinkedDirectDep[];
};

export async function linkDirectDeps(
  projects: Record<string, ProjectToLink>,
  opts: {
    dedupe: boolean;
  }
): Promise<number> {
  if (opts.dedupe && projects['.'] && Object.keys(projects).length > 1) {
    return linkDirectDepsAndDedupe(
      projects['.'],
      omit.default(['.'], projects)
    );
  }

  const numberOfLinkedDeps = await Promise.all(
    Object.values(projects).map(linkDirectDepsOfProject)
  );

  return numberOfLinkedDeps.reduce((sum: number, count: number): number => {
    return sum + count;
  }, 0);
}

async function linkDirectDepsAndDedupe(
  rootProject: ProjectToLink,
  projects: Record<string, ProjectToLink>
): Promise<number> {
  const linkedDeps = await linkDirectDepsOfProject(rootProject);

  const pkgsLinkedToRoot = await readLinkedDeps(rootProject.modulesDir);

  await Promise.all(
    Object.values(projects).map(
      async (project: ProjectToLink): Promise<void> => {
        const deletedAll = await deletePkgsPresentInRoot(
          project.modulesDir,
          pkgsLinkedToRoot
        );

        const dependencies = omitDepsFromRoot(
          project.dependencies,
          pkgsLinkedToRoot
        );

        if (dependencies.length > 0) {
          await linkDirectDepsOfProject({
            ...project,
            dependencies,
          });

          return;
        }

        if (deletedAll) {
          await rimraf(project.modulesDir);
        }
      }
    )
  );

  return linkedDeps;
}

function omitDepsFromRoot(
  deps: LinkedDirectDep[],
  pkgsLinkedToRoot: string[]
): LinkedDirectDep[] {
  return deps.filter(({ dir }: LinkedDirectDep): boolean => {
    return !pkgsLinkedToRoot.some(pathsEqual.bind(null, dir));
  });
}

function pathsEqual(path1: string, path2: string): boolean {
  return path.relative(path1, path2) === '';
}

async function readLinkedDeps(modulesDir: string): Promise<string[]> {
  const deps = (await readModulesDir(modulesDir)) ?? [];

  return Promise.all(
    deps.map((alias: string): Promise<string> => {
      return resolveLinkTargetOrFile(path.join(modulesDir, alias));
    })
  );
}

async function deletePkgsPresentInRoot(
  modulesDir: ModulesDir,
  pkgsLinkedToRoot: string[]
): Promise<boolean> {
  const pkgsLinkedToCurrentProject =
    await readLinkedDepsWithRealLocations(modulesDir);

  const pkgsToDelete = pkgsLinkedToCurrentProject.filter(
    ({
      linkedFrom,
      linkedTo,
    }: {
      linkedTo: string;
      linkedFrom: string;
    }): boolean => {
      return (
        linkedFrom !== linkedTo &&
        pkgsLinkedToRoot.some(pathsEqual.bind(null, linkedFrom))
      );
    }
  );

  await Promise.all(
    pkgsToDelete.map(
      ({
        linkedTo,
      }: {
        linkedTo: string;
        linkedFrom: string;
      }): Promise<void> => {
        return fs.promises.unlink(linkedTo);
      }
    )
  );

  return pkgsToDelete.length === pkgsLinkedToCurrentProject.length;
}

async function readLinkedDepsWithRealLocations(modulesDir: ModulesDir): Promise<
  Array<{
    linkedTo: string;
    linkedFrom: string;
  }>
> {
  const deps = (await readModulesDir(modulesDir)) ?? [];

  return Promise.all(
    deps.map(
      async (
        alias: string
      ): Promise<{ linkedTo: string; linkedFrom: string }> => {
        const linkedTo = path.join(modulesDir, alias);

        return {
          linkedTo,
          linkedFrom: await resolveLinkTargetOrFile(linkedTo),
        };
      }
    )
  );
}

async function resolveLinkTargetOrFile(filePath: string): Promise<string> {
  try {
    return await resolveLinkTarget(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'EINVAL' && err.code !== 'UNKNOWN') {
      throw err;
    }

    return filePath;
  }
}

async function linkDirectDepsOfProject(
  project: ProjectToLink
): Promise<number> {
  let linkedDeps = 0;

  await Promise.all(
    project.dependencies.map(async (dep: LinkedDirectDep): Promise<void> => {
      if (dep.isExternalLink) {
        await symlinkDirectRootDependency(
          dep.dir,
          project.modulesDir,
          dep.alias,
          {
            fromDependenciesField:
              dep.dependencyType === 'dev'
                ? 'devDependencies'
                : dep.dependencyType === 'optional'
                  ? 'optionalDependencies'
                  : 'dependencies',
            linkedPackage: {
              name: dep.name,
              version: dep.version,
            },
            prefix: project.dir,
          }
        );

        return;
      }

      if (
        (await symlinkDependency(dep.dir, project.modulesDir, dep.alias)).reused
      ) {
        return;
      }

      rootLogger.debug({
        added: {
          dependencyType: dep.dependencyType,
          id: dep.id,
          latest: dep.latest,
          name: dep.alias,
          realName: dep.name,
          version: dep.version,
        },
        prefix: project.dir,
      });

      linkedDeps++;
    })
  );

  return linkedDeps;
}
