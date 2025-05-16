import { promises as fs } from 'node:fs';
import path from 'node:path';

export const CURRENT_NODE_DIRNAME = 'nodejs_current';

export async function getNodeExecPathAndTargetDir(
  ospmHomeDir: string
): Promise<{ nodePath: string; nodeLink?: string | undefined }> {
  const nodePath = getNodeExecPathInBinDir(ospmHomeDir);

  const nodeCurrentDirLink = path.join(ospmHomeDir, CURRENT_NODE_DIRNAME);

  let nodeCurrentDir: string | undefined;

  try {
    nodeCurrentDir = await fs.readlink(nodeCurrentDirLink);
  } catch {
    nodeCurrentDir = undefined;
  }

  return {
    nodePath,
    nodeLink:
      typeof nodeCurrentDir === 'string'
        ? getNodeExecPathInNodeDir(nodeCurrentDir)
        : undefined,
  };
}

export function getNodeExecPathInBinDir(ospmHomeDir: string): string {
  return path.resolve(
    ospmHomeDir,
    process.platform === 'win32' ? 'node.exe' : 'node'
  );
}

export function getNodeExecPathInNodeDir(nodeDir: string): string {
  return path.join(
    nodeDir,
    process.platform === 'win32' ? 'node.exe' : 'bin/node'
  );
}
