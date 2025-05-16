// cspell:ignore diable
import {
  close as _close,
  closeSync,
  open as _open,
  promises as fs,
  unlinkSync,
  write as _write,
} from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { packageManager } from '../cli-meta/index.ts';
import { OspmError } from '../error/index.ts';
import { logger } from '../logger/index.ts';
import { type StoreServerHandle, createServer } from '../server/index.ts';
import {
  createNewStoreController,
  type CreateStoreControllerOptions,
  serverConnectionInfoDir,
} from '../store-connection-manager/index.ts';
import { getStorePath } from '../store-path/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Diable from '@zkochan/diable';
import getPort from 'get-port';
import isWindows from 'is-windows';
import { onExit } from 'signal-exit';

const storeServerLogger = logger('store-server');

const write = promisify(_write);
const close = promisify(_close);
const open = promisify(_open);

export async function start(
  opts: CreateStoreControllerOptions & {
    background?: boolean | undefined;
    protocol?: 'auto' | 'tcp' | 'ipc' | undefined;
    port?: number | undefined;
    ignoreStopRequests?: boolean | undefined;
    ignoreUploadRequests?: boolean | undefined;
  }
): Promise<void> {
  if (opts.protocol === 'ipc' && typeof opts.port !== 'undefined') {
    throw new Error('Port cannot be selected when server communicates via IPC');
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (opts.background === true && !Diable.isDaemon() === true) {
    Diable();
  }

  const storeDir = await getStorePath({
    pkgRoot: opts.dir,
    storePath: opts.storeDir,
    ospmHomeDir: opts.ospmHomeDir,
  });

  const connectionInfoDir = serverConnectionInfoDir(storeDir);

  const serverJsonPath = path.join(connectionInfoDir, 'server.json');

  await fs.mkdir(connectionInfoDir, { recursive: true });

  // Open server.json with exclusive write access to ensure only one process can successfully
  // start the server. Note: NFS does not support exclusive writing, but do we really care?
  // Source: https://github.com/moxystudio/node-proper-lockfile#user-content-comparison
  let fd: number | null;

  try {
    fd = await open(serverJsonPath, 'wx');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    throw new OspmError(
      'SERVER_MANIFEST_LOCKED',
      `Canceling startup of server (pid ${process.pid}) because another process got exclusive access to server.json`
    );
  }

  let server: null | StoreServerHandle = null;

  onExit((): void => {
    if (server !== null) {
      // Note that server.close returns a Promise, but we cannot wait for it because we may be
      // inside the 'exit' even of process.
      server.close();
    }

    if (fd !== null) {
      try {
        closeSync(fd);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        storeServerLogger.error(
          error,
          'Got error while closing file descriptor of server.json, but the process is already exiting'
        );
      }
    }

    try {
      unlinkSync(serverJsonPath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        storeServerLogger.error(
          error,
          'Got error unlinking server.json, but the process is already exiting'
        );
      }
    }
  });

  const store = await createNewStoreController(
    Object.assign(opts, {
      storeDir,
    })
  );

  const protocol =
    opts.protocol ?? (typeof opts.port === 'undefined' ? 'auto' : 'tcp');

  const serverOptions = await getServerOptions(connectionInfoDir, {
    protocol,
    port: opts.port,
  });

  const connectionOptions = {
    remotePrefix:
      typeof serverOptions.path === 'undefined'
        ? `http://${serverOptions.hostname}:${serverOptions.port}`
        : `http://unix:${serverOptions.path}:`,
  };

  server = createServer(store.ctrl, {
    ...serverOptions,
    ignoreStopRequests: opts.ignoreStopRequests,
    ignoreUploadRequests: opts.ignoreUploadRequests,
  });

  // Make sure to populate server.json after the server has started, so clients know that the server is
  // listening if a server.json with valid JSON content exists.
  const serverJson = {
    connectionOptions,
    pid: process.pid,
    ospmVersion: packageManager.version,
  };

  const serverJsonStr = JSON.stringify(serverJson, undefined, 2); // undefined and 2 are for formatting.

  const serverJsonBuffer = Buffer.from(serverJsonStr, 'utf8');

  // fs.write on NodeJS 4 requires the parameters offset and length to be set:
  // https://nodejs.org/docs/latest-v4.x/api/fs.html#fs_fs_write_fd_buffer_offset_length_position_callback
  await write(fd, serverJsonBuffer, 0, serverJsonBuffer.byteLength);

  const fdForClose = fd;

  // Set fd to null so we only attempt to close it once.
  fd = null;

  await close(fdForClose);

  // Intentionally avoid returning control back to the caller until the server
  // exits. This defers cleanup operations that should not run before the server
  // finishes.
  await server.waitForClose;
}

type ServerOptions = {
  hostname?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
};

async function getServerOptions(
  connectionInfoDir: string,
  opts: {
    protocol: 'auto' | 'tcp' | 'ipc';
    port?: number | undefined;
  }
): Promise<ServerOptions> {
  switch (opts.protocol) {
    case 'tcp': {
      return getTcpOptions();
    }

    case 'ipc': {
      if (isWindows()) {
        throw new Error('IPC protocol is not supported on Windows currently');
      }
      return getIpcOptions();
    }

    case 'auto': {
      if (isWindows()) {
        return getTcpOptions();
      }
      return getIpcOptions();
    }

    default: {
      throw new Error(`Protocol ${opts.protocol as string} is not supported`);
    }
  }

  async function getTcpOptions() {
    return {
      hostname: 'localhost',
      port: opts.port || (await getPort({ port: 5813 })), // eslint-disable-line
    };
  }

  function getIpcOptions(): ServerOptions {
    return {
      path: path.join(connectionInfoDir, 'socket'),
    };
  }
}
