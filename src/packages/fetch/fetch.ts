import assert from 'node:assert';
import util from 'node:util';
import { requestRetryLogger } from '../core-loggers/index.ts';
import { operation, type RetryTimeoutOptions } from '@zkochan/retry';
import nodeFetch, {
  type Request,
  type RequestInit as NodeRequestInit,
  Response,
} from 'node-fetch';

export { isRedirect } from 'node-fetch';

export { Response, type RetryTimeoutOptions };

type URLLike = {
  href: string;
};

const NO_RETRY_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_OSSL_PEM_NO_START_LINE',
]);

export type RequestInfo = string | URLLike | Request;

export interface RequestInit extends NodeRequestInit {
  retry?: RetryTimeoutOptions | undefined;
  timeout?: number | undefined;
}

export async function fetch(
  url: RequestInfo,
  opts: RequestInit = {}
): Promise<Response> {
  const retryOpts = opts.retry ?? {};
  const maxRetries = retryOpts.retries ?? 2;

  const op = operation({
    factor: retryOpts.factor ?? 10,
    maxTimeout: retryOpts.maxTimeout ?? 60_000,
    minTimeout: retryOpts.minTimeout ?? 10_000,
    randomize: false,
    retries: maxRetries,
  });

  try {
    return await new Promise((resolve, reject): void => {
      op.attempt(async (attempt: number): Promise<void> => {
        try {
          // this will be retried
          const res = await nodeFetch(url.toString(), opts);
          // A retry on 409 sometimes helps when making requests to the Bit registry.
          if (
            (res.status >= 500 && res.status < 600) ||
            [408, 409, 420, 429].includes(res.status)
          ) {
            throw new ResponseError(res);
          }

          resolve(res);
        } catch (error: unknown) {
          assert(util.types.isNativeError(error));

          if (
            'code' in error &&
            typeof error.code === 'string' &&
            NO_RETRY_ERROR_CODES.has(error.code)
          ) {
            throw error;
          }

          const timeout = op.retry(error);

          if (timeout === false) {
            reject(op.mainError());

            return;
          }

          requestRetryLogger.debug({
            attempt,
            error,
            maxRetries,
            method: opts.method ?? 'GET',
            timeout,
            url: url.toString(),
          });
        }
      });
    });
  } catch (err: unknown) {
    if (err instanceof ResponseError) {
      return err.res;
    }

    throw err;
  }
}

export class ResponseError extends Error {
  res: Response;
  code: number;
  status: number;
  statusCode: number;
  url: string;

  constructor(res: Response) {
    super(res.statusText);

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ResponseError);
    }

    this.name = this.constructor.name;
    this.res = res;

    // backward compat
    this.code = this.status = this.statusCode = res.status;
    this.url = res.url;
  }
}
