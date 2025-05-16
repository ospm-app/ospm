import { URL } from 'node:url';
import type { SslConfig } from '../types/index.ts';
import type { FetchFromRegistry } from '../fetching-types/index.ts';
import { getAgent, type AgentOptions } from '../network.agent/index.ts';
import {
  fetch,
  isRedirect,
  type Response,
  type RequestInfo,
  type RequestInit,
} from './fetch.ts';
import type { HeadersInit } from 'node-fetch';

const USER_AGENT = 'ospm'; // or maybe make it `${pkg.name}/${pkg.version} (+https://npm.im/${pkg.name})`

const ABBREVIATED_DOC =
  'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';
const JSON_DOC = 'application/json';
const MAX_FOLLOWED_REDIRECTS = 20;

export type FetchWithAgentOptions = RequestInit & {
  agentOptions: AgentOptions;
};

export function fetchWithAgent(
  url: RequestInfo,
  opts: FetchWithAgentOptions
): Promise<Response> {
  const agent = getAgent(
    typeof url === 'string' ? url : 'href' in url ? url.href : url.url,
    {
      ...opts.agentOptions,
      strictSsl: opts.agentOptions.strictSsl ?? true,
    }
  );

  const headers = opts.headers ?? {};

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore Element implicitly has an 'any' type because expression of type '"connection"' can't be used to index type 'HeadersInit'.
  //Property 'connection' does not exist on type 'HeadersInit'.ts(7053)
  headers.connection = agent ? 'keep-alive' : 'close';

  return fetch(url, {
    ...opts,
    agent,
  });
}

export type { AgentOptions };

export function createFetchFromRegistry(
  defaultOpts: {
    fullMetadata?: boolean | undefined;
    userAgent?: string | undefined;
    sslConfigs?: Record<string, SslConfig> | undefined;
  } & AgentOptions
): FetchFromRegistry {
  return async (url, opts): Promise<Response> => {
    const headers: Headers = {
      'user-agent': USER_AGENT,
      ...getHeaders({
        auth: opts?.authHeaderValue,
        fullMetadata: defaultOpts.fullMetadata,
        userAgent: defaultOpts.userAgent,
      }),
    };

    let redirects = 0;
    let urlObject = new URL(url);
    const originalHost = urlObject.host;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const agentOptions = {
        ...defaultOpts,
        ...opts,
        strictSsl: defaultOpts.strictSsl ?? true,
      } as any; // eslint-disable-line

      // We should pass a URL object to node-fetch till this is not resolved:
      // https://github.com/bitinn/node-fetch/issues/245
      const response = await fetchWithAgent(urlObject, {
        agentOptions: {
          ...agentOptions,
          clientCertificates: defaultOpts.sslConfigs,
        },
        // if verifying integrity, node-fetch must not decompress
        compress: opts?.compress ?? false,
        method: opts?.method ?? '',
        headers: headers as HeadersInit,
        redirect: 'manual',
        retry: opts?.retry,
        timeout: opts?.timeout ?? 60_000,
      });

      if (!isRedirect(response.status) || redirects >= MAX_FOLLOWED_REDIRECTS) {
        return response;
      }

      // This is a workaround to remove authorization headers on redirect.
      // Related pnpm issue: https://github.com/pnpm/pnpm/issues/1815
      redirects++;

      urlObject = new URL(response.headers.get('location') ?? '');

      if (
        typeof headers['authorization'] !== 'string' ||
        originalHost === urlObject.host
      ) {
        continue;
      }

      headers.authorization = '';
    }
  };
}

type Headers = {
  accept: string;
  authorization?: string | undefined;
  'user-agent'?: string | undefined;
};

function getHeaders(opts: {
  auth?: string | undefined;
  fullMetadata?: boolean | undefined;
  userAgent?: string | undefined;
}): Headers {
  const headers: Headers = {
    accept: opts.fullMetadata === true ? JSON_DOC : ABBREVIATED_DOC,
  };

  if (typeof opts.auth === 'string') {
    headers.authorization = opts.auth;
  }

  if (typeof opts.userAgent === 'string') {
    headers['user-agent'] = opts.userAgent;
  }

  return headers;
}
