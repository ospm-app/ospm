import path from 'node:path';
import type { Config } from '../config/index.ts';
import { globalInfo } from '../logger/index.ts';
import {
  serverConnectionInfoDir,
  tryLoadServerJson,
} from '../store-connection-manager/index.ts';
import { getStorePath } from '../store-path/index.ts';

export async function status(
  opts: Pick<Config, 'dir' | 'pnpmHomeDir' | 'storeDir'>
): Promise<void> {
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
    globalInfo(`No server is running for the store at ${storeDir}`);
    return;
  }

  console.info(
    `store: ${storeDir} process id: ${serverJson.pid} remote prefix: ${serverJson.connectionOptions.remotePrefix}`
  );
}
