import url from 'node:url';
import { requestRetryLogger } from '../core-loggers/index.ts';
import {
  FetchError,
  type FetchErrorRequest,
  type FetchErrorResponse,
  PnpmError,
} from '../error/index.ts';
import type {
  FetchFromRegistry,
  RetryTimeoutOptions,
} from '../fetching-types/index.ts';
import * as retry from '@zkochan/retry';
import type { PackageMeta } from './pickPackage.ts';

interface RegistryResponse {
  status: number;
  statusText: string;
  json: () => Promise<PackageMeta>;
}

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const semverRegex =
  // eslint-disable-next-line optimize-regex/optimize-regex
  /(.*)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export class RegistryResponseError extends FetchError {
  readonly pkgName: string;

  constructor(
    request: FetchErrorRequest,
    response: FetchErrorResponse,
    pkgName: string
  ) {
    let hint: string | undefined;

    if (response.status === 404) {
      hint = `${pkgName} is not in the npm registry, or you have no permission to fetch it.`;

      const matched = pkgName.match(semverRegex);

      if (matched != null) {
        hint += ` Did you mean ${matched[1]}?`;
      }
    }

    super(request, response, hint);

    this.pkgName = pkgName;
  }
}

export async function fromRegistry(
  fetch: FetchFromRegistry,
  fetchOpts: { retry: RetryTimeoutOptions; timeout: number },
  pkgName: string,
  registry: string,
  authHeaderValue?: string | undefined
): Promise<PackageMeta> {
  const uri = toUri(pkgName, registry);

  const op = retry.operation(fetchOpts.retry);

  return new Promise((resolve, reject) => {
    op.attempt(async (attempt) => {
      let response: RegistryResponse;
      try {
        response = (await fetch(uri, {
          authHeaderValue,
          compress: true,
          retry: fetchOpts.retry,
          timeout: fetchOpts.timeout,
        })) as RegistryResponse;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        reject(
          new PnpmError(
            'META_FETCH_FAIL',
            `GET ${uri}: ${error.message as string}`,
            { attempts: attempt }
          )
        );

        return;
      }

      if (response.status > 400) {
        const request = {
          authHeaderValue,
          url: uri,
        };

        reject(new RegistryResponseError(request, response, pkgName));

        return;
      }

      // Here we only retry broken JSON responses.
      // Other HTTP issues are retried by the @pnpm/fetch library
      try {
        resolve(await response.json());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        const timeout = op.retry(
          new PnpmError('BROKEN_METADATA_JSON', error.message)
        );

        if (timeout === false) {
          reject(op.mainError());
          return;
        }

        requestRetryLogger.debug({
          attempt,
          error,
          maxRetries: fetchOpts.retry.retries ?? 0,
          method: 'GET',
          timeout,
          url: uri,
        });
      }
    });
  });
}

function toUri(pkgName: string, registry: string): string {
  let encodedName: string;

  if (pkgName[0] === '@') {
    encodedName = `@${encodeURIComponent(pkgName.slice(1))}`;
  } else {
    encodedName = encodeURIComponent(pkgName);
  }

  return new url.URL(
    encodedName,
    registry.endsWith('/') ? registry : `${registry}/`
  ).toString();
}
