import fs from 'node:fs';
import path from 'node:path';
import { OspmError } from '../error/index.ts';
import { findUp } from 'find-up';
import process from 'node:process';
import type { WorkspaceDir } from '../types/project.ts';

const WORKSPACE_DIR_ENV_VAR = 'NPM_CONFIG_WORKSPACE_DIR';
const WORKSPACE_MANIFEST_FILENAME = 'ospm-workspace.yaml';
const INVALID_WORKSPACE_MANIFEST_FILENAME = [
  'ospm-workspaces.yaml',
  'ospm-workspaces.yml',
  'ospm-workspace.yml',
];

export async function findWorkspaceDir(
  cwd: string
): Promise<WorkspaceDir | undefined> {
  const workspaceManifestDirEnvVar =
    process.env[WORKSPACE_DIR_ENV_VAR] ??
    process.env[WORKSPACE_DIR_ENV_VAR.toLowerCase()];

  const workspaceManifestLocation =
    typeof workspaceManifestDirEnvVar === 'string'
      ? path.join(workspaceManifestDirEnvVar, WORKSPACE_MANIFEST_FILENAME)
      : await findUp(
          [WORKSPACE_MANIFEST_FILENAME, ...INVALID_WORKSPACE_MANIFEST_FILENAME],
          { cwd: await getRealPath(cwd) }
        );

  if (
    typeof workspaceManifestLocation === 'string' &&
    path.basename(workspaceManifestLocation) !== WORKSPACE_MANIFEST_FILENAME
  ) {
    throw new OspmError(
      'BAD_WORKSPACE_MANIFEST_NAME',
      `The workspace manifest file should be named "ospm-workspace.yaml". File found: ${workspaceManifestLocation}`
    );
  }

  return typeof workspaceManifestLocation === 'string'
    ? (path.dirname(workspaceManifestLocation) as WorkspaceDir)
    : undefined;
}

async function getRealPath(path: string): Promise<string> {
  return new Promise<string>((resolve) => {
    // We need to resolve the real native path for case-insensitive file systems.
    // For example, we can access file as C:\Code\Project as well as c:\code\projects
    // Without this we can face a problem when try to install packages with -w flag,
    // when root dir is using c:\code\projects but packages were found by C:\Code\Project
    fs.realpath.native(path, (err, resolvedPath) => {
      resolve(err !== null ? path : resolvedPath);
    });
  });
}
