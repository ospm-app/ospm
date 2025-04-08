import pick from 'ramda/src/pick';
import type {
  ProjectsList,
  WorkspaceState,
  WorkspaceStateSettings,
} from './types.ts';
import type { Project, ProjectRootDir } from '../types/index.ts';

export type CreateWorkspaceStateOptions = {
  allProjects: ProjectsList;
  pnpmfileExists?: boolean | undefined;
  filteredInstall?: boolean | undefined;
  settings: WorkspaceStateSettings;
  configDependencies?: Record<string, string> | undefined;
};

export function createWorkspaceState(
  opts: CreateWorkspaceStateOptions
): WorkspaceState {
  return {
    lastValidatedTimestamp: Date.now(),
    projects: Object.fromEntries(
      opts.allProjects.map(
        (
          project: Pick<Project, 'rootDir' | 'manifest'>
        ): [
          ProjectRootDir,
          {
            name?: string | undefined;
            version?: string | undefined;
          },
        ] => {
          return [
            project.rootDir,
            {
              name: project.manifest.name,
              version: project.manifest.version,
            },
          ];
        }
      )
    ),
    pnpmfileExists: opts.pnpmfileExists,
    settings: pick.default(
      [
        'autoInstallPeers',
        'catalogs',
        'dedupeDirectDeps',
        'dedupeInjectedDeps',
        'dedupePeerDependents',
        'dev',
        'excludeLinksFromLockfile',
        'hoistPattern',
        'hoistWorkspacePackages',
        'injectWorkspacePackages',
        'linkWorkspacePackages',
        'nodeLinker',
        'optional',
        'preferWorkspacePackages',
        'production',
        'publicHoistPattern',
        'workspacePackagePatterns',
      ],
      opts.settings
    ),
    filteredInstall: opts.filteredInstall,
    configDependencies: opts.configDependencies,
  };
}
