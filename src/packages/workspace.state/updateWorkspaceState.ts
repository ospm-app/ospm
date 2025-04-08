import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger/index.ts';
import { getFilePath } from './filePath.ts';
import { createWorkspaceState } from './createWorkspaceState.ts';
import type { WorkspaceStateSettings, ProjectsList } from './types.ts';
import type { WorkspaceDir } from '../types/project.ts';

export type UpdateWorkspaceStateOptions = {
  allProjects: ProjectsList;
  settings: WorkspaceStateSettings;
  workspaceDir: WorkspaceDir;
  pnpmfileExists?: boolean | undefined;
  filteredInstall?: boolean | undefined;
  configDependencies?: Record<string, string> | undefined;
};

export async function updateWorkspaceState(
  opts: UpdateWorkspaceStateOptions
): Promise<void> {
  logger.debug({ msg: 'updating workspace state' });

  const workspaceState = createWorkspaceState(opts);

  const workspaceStateJSON = `${JSON.stringify(workspaceState, undefined, 2)}\n`;

  const cacheFile = getFilePath(opts.workspaceDir);

  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });

  await fs.promises.writeFile(cacheFile, workspaceStateJSON);
}
