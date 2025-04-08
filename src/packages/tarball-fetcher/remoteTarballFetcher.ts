import assert from 'node:assert';
import type { IncomingMessage } from 'node:http';
import util from 'node:util';
import { requestRetryLogger } from '../core-loggers/index.ts';
import { FetchError } from '../error/index.ts';
import type { FetchOptions } from '../fetcher-base/index.ts';
import type { Cafs } from '../cafs-types/index.ts';
import type { FetchFromRegistry } from '../fetching-types/index.ts';
import { addFilesFromTarball, type AddFilesResult } from '../worker/index.ts';
import * as retry from '@zkochan/retry';
import throttle from 'lodash.throttle';
import { BadTarballError } from './errorTypes/index.ts';

const BIG_TARBALL_SIZE = 1024 * 1024 * 5; // 5 MB

export type HttpResponse = {
  body: string;
};

export type DownloadFunction = (
  url: string,
  opts: {
    getAuthHeaderByURI: (registry: string) => string | undefined;
    cafs: Cafs;
    readManifest?: boolean | undefined;
    registry?: string | undefined;
    onStart?: ((totalSize: number | null, attempt: number) => void) | undefined;
    onProgress?: ((downloaded: number) => void) | undefined;
    integrity?: string | undefined;
    filesIndexFile: string;
  } & Pick<FetchOptions, 'pkg'>
) => Promise<AddFilesResult>;

export type NpmRegistryClient = {
  get: (
    url: string,
    getOpts: object,
    cb: (err: Error, data: object, raw: object, res: HttpResponse) => void
  ) => void;
  fetch: (
    url: string,
    opts: { auth?: object },
    cb: (err: Error, res: IncomingMessage) => void
  ) => void;
};

export function createDownloader(
  fetchFromRegistry: FetchFromRegistry,
  gotOpts: {
    retry?:
      | {
          retries?: number | undefined;
          factor?: number | undefined;
          minTimeout?: number | undefined;
          maxTimeout?: number | undefined;
          randomize?: boolean | undefined;
        }
      | undefined;
    timeout?: number | undefined;
  }
): DownloadFunction {
  const retryOpts = {
    factor: 10,
    maxTimeout: 6e4, // 1 minute
    minTimeout: 1e4, // 10 seconds
    retries: 2,
    ...gotOpts.retry,
  };

  return async function download(
    url: string,
    opts: {
      getAuthHeaderByURI: (registry: string) => string | undefined;
      cafs: Cafs;
      readManifest?: boolean | undefined;
      registry?: string | undefined;
      onStart?:
        | ((totalSize: number | null, attempt: number) => void)
        | undefined;
      onProgress?: ((downloaded: number) => void) | undefined;
      integrity?: string | undefined;
      filesIndexFile: string;
    } & Pick<FetchOptions, 'pkg'>
  ): Promise<AddFilesResult> {
    const authHeaderValue = opts.getAuthHeaderByURI(url);

    const op = retry.operation({
      ...retryOpts,
      factor: retryOpts.factor ?? 10,
      maxTimeout: retryOpts.maxTimeout ?? 60_000,
      minTimeout: retryOpts.minTimeout ?? 10_000,
      retries: retryOpts.retries ?? 2,
      randomize: retryOpts.randomize ?? false,
    });

    return new Promise<AddFilesResult>((resolve, reject) => {
      op.attempt(async (attempt) => {
        try {
          resolve(await fetch(attempt));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          if (
            error.response?.status === 401 ||
            error.response?.status === 403 ||
            error.response?.status === 404 ||
            error.code === 'ERR_PNPM_PREPARE_PKG_FAILURE'
          ) {
            reject(error);
            return;
          }
          const timeout = op.retry(error);
          if (timeout === false) {
            reject(op.mainError());
            return;
          }
          requestRetryLogger.debug({
            attempt,
            error,
            maxRetries: retryOpts.retries ?? 2,
            method: 'GET',
            timeout,
            url,
          });
        }
      });
    });

    async function fetch(currentAttempt: number): Promise<AddFilesResult> {
      let data: Buffer;
      try {
        const res = await fetchFromRegistry(url, {
          authHeaderValue,
          // The fetch library can retry requests on bad HTTP responses.
          // However, it is not enough to retry on bad HTTP responses only.
          // Requests should also be retried when the tarball's integrity check fails.
          // Hence, we tell fetch to not retry,
          // and we perform the retries from this function instead.
          retry: { retries: 0 },
          timeout: gotOpts.timeout,
        });

        if (res.status !== 200) {
          throw new FetchError({ url, authHeaderValue }, res);
        }

        const contentLength =
          res.headers.has('content-length') ||
          res.headers.get('content-length');

        const size =
          typeof contentLength === 'string'
            ? Number.parseInt(contentLength, 10)
            : null;

        if (opts.onStart != null) {
          opts.onStart(size, currentAttempt);
        }

        // In order to reduce the amount of logs, we only report the download progress of big tarballs
        const onProgress =
          size != null && size >= BIG_TARBALL_SIZE && opts.onProgress
            ? throttle(opts.onProgress, 500)
            : undefined;

        let downloaded = 0;

        const chunks: Buffer[] = [];

        // This will handle the 'data', 'error', and 'end' events.
        // eslint-disable-next-line es-x/no-async-iteration
        for await (const chunk of res.body ?? []) {
          chunks.push(chunk as Buffer);

          downloaded += chunk.length;

          onProgress?.(downloaded);
        }

        if (size !== null && size !== downloaded) {
          throw new BadTarballError({
            expectedSize: size,
            receivedSize: downloaded,
            tarballUrl: url,
          });
        }

        data = Buffer.from(new SharedArrayBuffer(downloaded));

        let offset = 0;

        for (const chunk of chunks) {
          chunk.copy(data, offset);
          offset += chunk.length;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        assert(util.types.isNativeError(err));

        Object.assign(err, {
          attempts: currentAttempt,
          resource: url,
        });

        throw err;
      }

      return addFilesFromTarball({
        buffer: data,
        storeDir: opts.cafs.storeDir,
        readManifest: opts.readManifest,
        integrity: opts.integrity,
        filesIndexFile: opts.filesIndexFile,
        url,
        pkg: opts.pkg,
      });
    }
  };
}
