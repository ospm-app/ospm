import type { RetryTimeoutOptions } from '@zkochan/retry';
import type { Response, RequestInit as NodeRequestInit } from 'node-fetch';

export type { RetryTimeoutOptions };

export interface RequestInit extends NodeRequestInit {
  retry?: RetryTimeoutOptions | undefined;
  timeout?: number | undefined;
}

export type FetchFromRegistry = (
  url: string,
  opts?:
    | (RequestInit & {
        authHeaderValue?: string | undefined;
        compress?: boolean | undefined;
        retry?: RetryTimeoutOptions | undefined;
        timeout?: number | undefined;
      })
    | undefined
) => Promise<Response>;

export type GetAuthHeader = (uri: string) => string | undefined;
