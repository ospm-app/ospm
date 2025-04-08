// cspell:ignore noent
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { packageManager } from '../cli-meta/index.ts';
import type { Config } from '../config/index.ts';
import { PnpmError } from '../error/index.ts';
import { logger } from '../logger/index.ts';
import type { PackageResponse } from '../package-store/index.ts';
import type { StoreServerController } from '../server/index.ts';
import { getStorePath } from '../store-path/index.ts';
import delay from 'delay';
import {
  createNewStoreController,
  createNewServerStoreController,
  type CreateNewStoreControllerOptions,
} from './createNewStoreController.ts';
import { runServerInBackground } from './runServerInBackground.ts';
import { serverConnectionInfoDir } from './serverConnectionInfoDir.ts';
import { connectStoreManagerController } from '../server/connectStoreController.ts';

export {
  serverConnectionInfoDir,
  createNewStoreController,
  createNewServerStoreController,
};

export type CreateStoreControllerOptions = Omit<
  CreateNewStoreControllerOptions,
  'storeDir'
> &
  Pick<
    Config,
    | 'storeDir'
    | 'dir'
    | 'pnpmHomeDir'
    | 'useRunningStoreServer'
    | 'useStoreServer'
    | 'workspaceDir'
  >;

export async function createOrConnectStoreController(
  opts: CreateStoreControllerOptions
): Promise<{
  ctrl: StoreServerController<
    PackageResponse,
    PackageResponse,
    {
      isBuilt: boolean;
      importMethod?: string | undefined;
    }
  >;
  dir: string;
}> {
  const storeDir = await getStorePath({
    pkgRoot: opts.workspaceDir ?? opts.dir,
    storePath: opts.storeDir,
    pnpmHomeDir: opts.pnpmHomeDir,
  });

  const connectionInfoDir = serverConnectionInfoDir(storeDir);

  const serverJsonPath = path.join(connectionInfoDir, 'server.json');

  let serverJson = await tryLoadServerJson({
    serverJsonPath,
    shouldRetryOnNoent: false,
  });

  if (serverJson !== null) {
    if (serverJson.pnpmVersion !== packageManager.version) {
      logger.warn({
        message: `The store server runs on pnpm v${serverJson.pnpmVersion}. It is recommended to connect with the same version (current is v${packageManager.version})`,
        prefix: opts.dir,
      });
    }

    logger.info({
      message:
        'A store server is running. All store manipulations are delegated to it.',
      prefix: opts.dir,
    });

    return {
      ctrl: await connectStoreManagerController(serverJson.connectionOptions),
      dir: storeDir,
    };
  }

  if (opts.useRunningStoreServer === true) {
    throw new PnpmError('NO_STORE_SERVER', 'No store server is running.');
  }

  if (opts.useStoreServer === true) {
    runServerInBackground(storeDir);

    serverJson = await tryLoadServerJson({
      serverJsonPath,
      shouldRetryOnNoent: true,
    });

    logger.info({
      message:
        'A store server has been started. To stop it, use `pnpm server stop`',
      prefix: opts.dir,
    });

    const connectionOptions = serverJson?.connectionOptions;

    if (typeof connectionOptions === 'undefined') {
      throw new Error('Connection options are undefined');
    }

    return {
      ctrl: await connectStoreManagerController<{
        isBuilt: boolean;
        importMethod?: string | undefined;
      }>(connectionOptions),
      dir: storeDir,
    };
  }

  return createNewServerStoreController(
    Object.assign(opts, {
      storeDir,
    })
  );
}

export async function tryLoadServerJson(options: {
  serverJsonPath: string;
  shouldRetryOnNoent: boolean;
}): Promise<null | {
  connectionOptions: {
    remotePrefix: string;
  };
  pid: number;
  pnpmVersion: string;
}> {
  let beforeFirstAttempt = true;

  const startHRTime = process.hrtime();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (!beforeFirstAttempt) {
      const elapsedHRTime = process.hrtime(startHRTime);
      // Time out after 10 seconds of waiting for the server to start, assuming something went wrong.
      // E.g. server got a SIGTERM or was otherwise abruptly terminated, server has a bug or a third
      // party is interfering.
      if (elapsedHRTime[0] >= 10) {
        // Delete the file in an attempt to recover from this bad state.
        try {
          await fs.unlink(options.serverJsonPath);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          // Either the server.json was manually removed or another process already removed it.
        }

        return null;
      }

      // Poll for server startup every 200 milliseconds.
      await delay(200);
    }

    beforeFirstAttempt = false;

    let serverJsonStr: string | null;

    try {
      serverJsonStr = await fs.readFile(options.serverJsonPath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      if (!options.shouldRetryOnNoent) {
        return null;
      }

      continue;
    }

    let serverJson: {
      connectionOptions: { remotePrefix: string };
      pid: number;
      pnpmVersion: string;
    } | null;

    try {
      // TODO: valibot schema
      serverJson = JSON.parse(serverJsonStr) as {
        connectionOptions: { remotePrefix: string };
        pid: number;
        pnpmVersion: string;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    } catch (_error: any) {
      // Server is starting or server.json was modified by a third party.
      // We assume the best case and retry.
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (serverJson === null) {
      // Our server should never write null to server.json, even though it is valid json.
      throw new Error('server.json was modified by a third party');
    }

    return serverJson;
  }
}
