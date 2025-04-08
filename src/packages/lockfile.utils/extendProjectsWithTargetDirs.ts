import path from 'node:path';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { depPathToFilename } from '../dependency-path/index.ts';
import type { ProjectId, DepPath } from '../types/index.ts';
import { packageIdFromSnapshot } from './packageIdFromSnapshot.ts';
import { nameVerFromPkgSnapshot } from './nameVerFromPkgSnapshot.ts';

type GetLocalLocations = (depPath: DepPath, pkgName: string) => string[];

export function extendProjectsWithTargetDirs<T>(
  projects: Array<T & { id: ProjectId }>,
  lockfile: LockfileObject,
  ctx: {
    virtualStoreDir: string;
    pkgLocationsByDepPath?: Record<DepPath, string[]> | undefined;
    virtualStoreDirMaxLength: number;
  }
): Array<T & { id: ProjectId; stages: string[]; targetDirs: string[] }> {
  const getLocalLocations: GetLocalLocations =
    typeof ctx.pkgLocationsByDepPath === 'undefined'
      ? (depPath: DepPath, pkgName: string): string[] => {
          return [
            path.join(
              ctx.virtualStoreDir,
              depPathToFilename(depPath, ctx.virtualStoreDirMaxLength),
              'node_modules',
              pkgName
            ),
          ];
        }
      : (depPath: DepPath): string[] => {
          return ctx.pkgLocationsByDepPath?.[depPath] ?? [];
        };

  const projectsById: Record<
    ProjectId,
    T & { id: ProjectId; targetDirs: string[]; stages?: string[] }
  > = Object.fromEntries(
    projects.map(
      (
        project: T & {
          id: ProjectId;
        }
      ): [
        ProjectId,
        T & {
          targetDirs: string[];
          id: ProjectId;
        },
      ] => {
        return [project.id, { ...project, targetDirs: [] as string[] }];
      }
    )
  );

  for (const [depPath, pkg] of Object.entries(lockfile.packages ?? {})) {
    if (
      typeof pkg.resolution === 'undefined' ||
      !('type' in pkg.resolution) ||
      pkg.resolution.type !== 'directory'
    ) {
      continue;
    }

    const pkgId = packageIdFromSnapshot(depPath as DepPath, pkg);

    const { name: pkgName } = nameVerFromPkgSnapshot(depPath, pkg);

    const importerId = pkgId.replace(/^file:/, '') as ProjectId;

    if (projectsById[importerId] == null) {
      continue;
    }

    const localLocations = getLocalLocations(depPath as DepPath, pkgName);

    if (!Array.isArray(localLocations) || localLocations.length === 0) {
      continue;
    }

    projectsById[importerId].targetDirs.push(...localLocations);

    projectsById[importerId].stages = [
      'preinstall',
      'install',
      'postinstall',
      'prepare',
      'prepublishOnly',
    ];
  }

  return Object.values(projectsById) as Array<
    T & { id: ProjectId; stages: string[]; targetDirs: string[] }
  >;
}
