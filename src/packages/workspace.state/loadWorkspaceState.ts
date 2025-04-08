import fs from 'node:fs';
import util from 'node:util';
import { logger } from '../logger/index.ts';
import { getFilePath } from './filePath.ts';
import type { WorkspaceState } from './types.ts';

export function loadWorkspaceState(
  workspaceDir: string
): WorkspaceState | undefined {
  logger.debug({ msg: 'loading workspace state' });

  const cacheFile = getFilePath(workspaceDir);

  let cacheFileContent: string;

  try {
    cacheFileContent = fs.readFileSync(cacheFile, 'utf-8');
  } catch (error) {
    if (
      util.types.isNativeError(error) &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }

    throw error;
  }

  // TODO: valibot schema
  return JSON.parse(cacheFileContent) as WorkspaceState;
}
