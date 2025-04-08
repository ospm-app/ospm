import type { Config } from '../config/index.ts';
import type { Project, ProjectRootDir } from '../types/index.ts';

export type ProjectsList = Array<Pick<Project, 'rootDir' | 'manifest'>>;

export interface WorkspaceState {
  lastValidatedTimestamp: number;
  projects: Record<
    ProjectRootDir,
    {
      name?: string | undefined;
      version?: string | undefined;
    }
  >;
  pnpmfileExists?: boolean | undefined;
  filteredInstall?: boolean | undefined;
  configDependencies?: Record<string, string> | undefined;
  settings: WorkspaceStateSettings;
}

export type WorkspaceStateSettings = Pick<
  Config,
  | 'autoInstallPeers'
  | 'catalogs'
  | 'dedupeDirectDeps'
  | 'dedupeInjectedDeps'
  | 'dedupePeerDependents'
  | 'dev'
  | 'excludeLinksFromLockfile'
  | 'hoistPattern'
  | 'hoistWorkspacePackages'
  | 'injectWorkspacePackages'
  | 'linkWorkspacePackages'
  | 'nodeLinker'
  | 'optional'
  | 'preferWorkspacePackages'
  | 'production'
  | 'publicHoistPattern'
  | 'workspacePackagePatterns'
>;
