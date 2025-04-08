import type { ProjectManifest } from './package.ts';

export type Project = {
  rootDir: ProjectRootDir;
  rootDirRealPath: ProjectRootDirRealPath;
  modulesDir?: ModulesDir | undefined;
  manifest: ProjectManifest;
  writeProjectManifest: (
    manifest: ProjectManifest,
    force?: boolean | undefined
  ) => Promise<void>;
};

export type ProjectsGraph = Record<
  | ProjectRootDir
  | ProjectRootDirRealPath
  | GlobalPkgDir
  | WorkspaceDir
  | LockFileDir,
  { dependencies: ProjectRootDir[]; package: Project }
>;

export type LockFileDir = string & { __brand: 'LockFileDir' };
export type ModulesDir = string & { __brand: 'ModulesDir' };
export type ProjectRootDir = string & { __brand: 'ProjectRootDir' };
export type GlobalPkgDir = string & { __brand: 'GlobalPkgDir' };
export type WorkspaceDir = string & { __brand: 'WorkspaceDir' };

export type ProjectRootDirRealPath = string & {
  __brand: 'ProjectRootDirRealPath';
};
