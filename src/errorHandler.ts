import { promisify } from 'node:util';
import { logger } from './packages/logger/index.ts';
import pidTree from 'pidtree';
import { type Global, REPORTER_INITIALIZED } from './main.ts';

declare const global: Global;

const getDescendentProcesses = promisify(
  (
    pid: number,
    callback: (error: Error | undefined, result: number[]) => void
  ) => {
    pidTree(pid, { root: false }, callback);
  }
);

export async function errorHandler(
  error: Error & { code?: string }
): Promise<void> {
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    error.name != null &&
    error.name !== 'ospm' &&
    !error.name.startsWith('ospm:')
  ) {
    try {
      error.name = 'ospm';
    } catch {
      // Sometimes the name property is read-only
    }
  }

  if (typeof global[REPORTER_INITIALIZED] === 'undefined') {
    // print parseable error on unhandled exception
    console.info(
      JSON.stringify(
        {
          error: {
            code: error.code ?? error.name,
            message: error.message,
          },
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  if (global[REPORTER_INITIALIZED] === 'silent') {
    process.exitCode = 1;
    return;
  }

  // bole passes only the name, message and stack of an error
  // that is why we pass error as a message as well, to pass
  // any additional info
  logger.error(error, error);

  // Deferring exit. Otherwise, the reporter wouldn't show the error
  setTimeout(async () => {
    await killProcesses(
      'errno' in error && typeof error.errno === 'number' ? error.errno : 1
    );
  }, 0);
}

async function killProcesses(status: number): Promise<void> {
  try {
    const descendentProcesses = await getDescendentProcesses(process.pid);
    for (const pid of descendentProcesses) {
      try {
        process.kill(pid);
      } catch {
        // ignore error here
      }
    }
  } catch {
    // ignore error here
  }

  // eslint-disable-next-line n/no-process-exit
  process.exit(status);
}
