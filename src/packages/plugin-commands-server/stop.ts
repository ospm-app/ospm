import { promisify } from 'node:util';
import path from 'node:path';
import { globalInfo, globalWarn } from '../logger/index.ts';
import { connectStoreController } from '../server/index.ts';
import {
  serverConnectionInfoDir,
  tryLoadServerJson,
} from '../store-connection-manager/index.ts';
import { getStorePath } from '../store-path/index.ts';
import delay from 'delay';
import { processExists } from 'process-exists';
import killcb from 'tree-kill';

const kill = promisify(killcb) as (
  pid: number,
  signal: string
) => Promise<void>;

export async function stop(opts: {
  storeDir?: string | undefined;
  dir: string;
  pnpmHomeDir: string;
}): Promise<void> {
  const storeDir = await getStorePath({
    pkgRoot: opts.dir,
    storePath: opts.storeDir,
    pnpmHomeDir: opts.pnpmHomeDir,
  });

  const connectionInfoDir = serverConnectionInfoDir(storeDir);

  const serverJson = await tryLoadServerJson({
    serverJsonPath: path.join(connectionInfoDir, 'server.json'),
    shouldRetryOnNoent: false,
  });

  if (serverJson === null) {
    globalInfo(
      `Nothing to stop. No server is running for the store at ${storeDir}`
    );
    return;
  }

  const storeController = await connectStoreController(
    serverJson.connectionOptions
  );

  await storeController.stop();

  if (await serverGracefullyStops(serverJson.pid)) {
    globalInfo('Server gracefully stopped');
    return;
  }

  globalWarn('Graceful shutdown failed');

  await kill(serverJson.pid, 'SIGINT');

  globalInfo('Server process terminated');
}

async function serverGracefullyStops(pid: number): Promise<boolean> {
  if ((await processExists(pid)) !== true) {
    return true;
  }

  await delay(5000);

  return (await processExists(pid)) !== true;
}
