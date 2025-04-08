import assert from 'node:assert';
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import util from 'node:util';
import { globalInfo } from '../logger/index.ts';
import type {
  FetchPackageToStoreOptions,
  PackageResponse,
  PkgRequestFetchResult,
  RequestPackageOptions,
  StoreController,
  UploadPkgToStoreOpts,
} from '../store-controller-types/index.ts';
import { locking } from './lock.ts';
import type { ImportPackageOpts } from '../cafs-types/index.ts';
import type { WantedDependency } from '../resolve-dependencies/index.ts';

type RequestPackageBody = {
  msgId: string;
  wantedDependency: WantedDependency;
  options: RequestPackageOptions;
  prefix: string;
  opts: {
    addDependencies: string[];
    removeDependencies: string[];
    prune: boolean;
  };
  storePath: string;
  id: string;
  searchQueries: string[];
};

type FetchPackageBody = {
  msgId: string;
  wantedDependency: WantedDependency;
  options: FetchPackageToStoreOptions;
  prefix: string;
  opts: {
    addDependencies: string[];
    removeDependencies: string[];
    prune: boolean;
  };
  storePath: string;
  id: string;
  searchQueries: string[];
};

export type StoreServerHandle = {
  close: () => Promise<void>;
  waitForClose: Promise<void>;
};

export function createServer(
  store: StoreController<
    PackageResponse,
    PackageResponse,
    { isBuilt: boolean; importMethod?: string | undefined }
  >,
  opts: {
    path?: string | undefined;
    port?: number | undefined;
    hostname?: string | undefined;
    ignoreStopRequests?: boolean | undefined;
    ignoreUploadRequests?: boolean | undefined;
  }
): StoreServerHandle {
  const filesPromises: Record<
    string,
    (() => Promise<PkgRequestFetchResult<PackageResponse>>) | undefined
  > = {};

  const lock = locking<void>();

  const server = http.createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.statusCode = 405; // Method Not Allowed
        const responseError = {
          error: `Only POST is allowed, received ${req.method ?? 'unknown'}`,
        };
        res.setHeader('Allow', 'POST');
        res.end(JSON.stringify(responseError));
        return;
      }

      try {
        let requestPackageBody: RequestPackageBody;
        let fetchPackageBody: FetchPackageBody;

        switch (req.url) {
          case '/requestPackage': {
            const bodyPromise = new Promise<RequestPackageBody>(
              (resolve, reject): void => {
                let body: any = ''; // eslint-disable-line

                req.on('data', (data) => {
                  body += data;
                });

                req.on('end', async () => {
                  try {
                    if (body.length > 0) {
                      body = JSON.parse(body);
                    } else {
                      body = {};
                    }
                    resolve(body);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } catch (e: any) {
                    reject(e);
                  }
                });
              }
            );

            try {
              requestPackageBody = await bodyPromise;

              const pkgResponse = await store.requestPackage(
                requestPackageBody.wantedDependency,
                requestPackageBody.options
              );

              if (typeof pkgResponse.fetching === 'function') {
                filesPromises[requestPackageBody.msgId] = pkgResponse.fetching;
              }

              res.end(JSON.stringify(pkgResponse.body));
            } catch (err: unknown) {
              assert(util.types.isNativeError(err));

              res.end(
                JSON.stringify({
                  error: {
                    message: err.message,
                    ...(JSON.parse(JSON.stringify(err)) as Record<
                      string,
                      unknown
                    >),
                  },
                })
              );
            }

            break;
          }

          case '/fetchPackage': {
            const bodyPromise = new Promise<FetchPackageBody>(
              (resolve, reject): void => {
                let body: any = ''; // eslint-disable-line

                req.on('data', (data) => {
                  body += data;
                });

                req.on('end', async () => {
                  try {
                    if (body.length > 0) {
                      body = JSON.parse(body);
                    } else {
                      body = {};
                    }
                    resolve(body);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } catch (e: any) {
                    reject(e);
                  }
                });
              }
            );

            try {
              fetchPackageBody = await bodyPromise;

              const pkgResponse = await store.fetchPackage(
                fetchPackageBody.options
              );

              filesPromises[fetchPackageBody.msgId] = pkgResponse.fetching;

              res.end(
                JSON.stringify({ filesIndexFile: pkgResponse.filesIndexFile })
              );
            } catch (err: unknown) {
              assert(util.types.isNativeError(err));
              res.end(
                JSON.stringify({
                  error: {
                    message: err.message,
                    ...(JSON.parse(JSON.stringify(err)) as Record<
                      string,
                      unknown
                    >),
                  },
                })
              );
            }
            break;
          }

          case '/packageFilesResponse': {
            const bodyPromise = new Promise<RequestPackageBody>(
              (resolve, reject): void => {
                let body: any = ''; // eslint-disable-line

                req.on('data', (data) => {
                  body += data;
                });

                req.on('end', async () => {
                  try {
                    if (body.length > 0) {
                      body = JSON.parse(body);
                    } else {
                      body = {};
                    }
                    resolve(body);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } catch (e: any) {
                    reject(e);
                  }
                });
              }
            );

            const body = await bodyPromise;

            const filesResponse = await filesPromises[body.msgId]?.();

            delete filesPromises[body.msgId];

            res.end(JSON.stringify(filesResponse));

            break;
          }

          case '/prune': {
            // Disable store pruning when a server is running
            res.statusCode = 403;
            res.end();
            break;
          }

          case '/importPackage': {
            const bodyPromise = new Promise<{
              to: string;
              opts: ImportPackageOpts;
            }>((resolve, reject): void => {
              let body: any = ''; // eslint-disable-line

              req.on('data', (data) => {
                body += data;
              });

              req.on('end', async () => {
                try {
                  if (body.length > 0) {
                    body = JSON.parse(body);
                  } else {
                    body = {};
                  }
                  resolve(body);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (e: any) {
                  reject(e);
                }
              });
            });

            const importPackageBody = await bodyPromise;

            await store.importPackage(
              importPackageBody.to,
              importPackageBody.opts
            );

            res.end(JSON.stringify('OK'));

            break;
          }

          case '/upload': {
            // Do not return an error status code, just ignore the upload request entirely
            if (opts.ignoreUploadRequests === true) {
              res.statusCode = 403;

              res.end();

              break;
            }

            const bodyPromise = new Promise<{
              builtPkgLocation: string;
              opts: UploadPkgToStoreOpts;
            }>((resolve, reject): void => {
              let body: any = ''; // eslint-disable-line

              req.on('data', (data) => {
                body += data;
              });

              req.on('end', async () => {
                try {
                  if (body.length > 0) {
                    body = JSON.parse(body);
                  } else {
                    body = {};
                  }
                  resolve(body);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (e: any) {
                  reject(e);
                }
              });
            });

            const uploadBody = await bodyPromise;

            await lock(uploadBody.builtPkgLocation, async () =>
              store.upload(uploadBody.builtPkgLocation, uploadBody.opts)
            );

            res.end(JSON.stringify('OK'));

            break;
          }

          case '/stop': {
            if (opts.ignoreStopRequests === true) {
              res.statusCode = 403;

              res.end();

              break;
            }

            globalInfo('Got request to stop the server');

            await close();

            res.end(JSON.stringify('OK'));

            globalInfo('Server stopped');

            break;
          }

          default: {
            res.statusCode = 404;

            const error = {
              error: `${req.url ?? ''} does not match any route`,
            };

            res.end(JSON.stringify(error));
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        res.statusCode = 503;

        const jsonErr = JSON.parse(JSON.stringify(e)) as Record<
          string,
          unknown
        >;

        jsonErr.message = e.message;

        res.end(JSON.stringify(jsonErr));
      }
    }
  );

  let listener: Server;

  if (typeof opts.path === 'string') {
    listener = server.listen(opts.path);
  } else {
    listener = server.listen(opts.port, opts.hostname);
  }

  const waitForClose = new Promise<void>((resolve) =>
    listener.once('close', () => {
      resolve();
    })
  );

  return { close, waitForClose };

  async function close(): Promise<void> {
    listener.close();
    return store.close();
  }
}
