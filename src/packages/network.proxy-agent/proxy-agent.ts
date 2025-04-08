import { PnpmError } from '../error/index.ts';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent, type HttpProxyAgentOptions } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as LRU from 'lru-cache';
import type { ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';

const DEFAULT_MAX_SOCKETS = 50;

const AGENT_CACHE = new LRU.LRUCache<
  string,
  HttpProxyAgent<string> | PatchedHttpsProxyAgent | SocksProxyAgent
>({ max: 50 });

export type ProxyAgentOptions = {
  ca?: string | string[] | undefined;
  cert?: string | string[] | undefined;
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  key?: string | undefined;
  localAddress?: string | undefined;
  maxSockets?: number | undefined;
  noProxy?: boolean | string | undefined;
  strictSsl?: boolean | undefined;
  timeout?: number | undefined;
  clientCertificates?:
    | {
        [registryUrl: string]: {
          cert: string;
          key: string;
          ca?: string | undefined;
        };
      }
    | undefined;
};

export function getProxyAgent(
  uri: string,
  opts: ProxyAgentOptions
):
  | HttpProxyAgent<string>
  | PatchedHttpsProxyAgent
  | SocksProxyAgent
  | undefined {
  const parsedUri = new URL(uri);

  const pxuri = getProxyUri(parsedUri, opts);

  if (!pxuri) {
    return;
  }

  const isHttps = parsedUri.protocol === 'https:';

  const key = [
    `https:${isHttps.toString()}`,
    `proxy:${pxuri.protocol}//${pxuri.username}:${pxuri.password}@${pxuri.host}:${pxuri.port}`,
    `local-address:${opts.localAddress ?? '>no-local-address<'}`,
    `strict-ssl:${
      isHttps ? Boolean(opts.strictSsl).toString() : '>no-strict-ssl<'
    }`,
    `ca:${(isHttps && (opts.ca?.toString() ?? '>noca<')) || '>no-ca<'}`,
    `cert:${(isHttps && (opts.cert?.toString() ?? '>no-cert<')) || '>no-cert<'}`,
    `key:${(isHttps && (opts.key ?? '>no-key<')) || '>no-key<'}`,
  ].join(':');

  if (typeof AGENT_CACHE.peek(key) !== 'undefined') {
    return AGENT_CACHE.get(key);
  }

  const proxy = getProxy(pxuri, opts, isHttps);

  AGENT_CACHE.set(key, proxy);

  return proxy;
}

function getProxyUri(
  uri: URL,
  opts: {
    httpProxy?: string | undefined;
    httpsProxy?: string | undefined;
  }
): URL | undefined {
  const { protocol } = uri;

  let proxy: string | undefined;
  switch (protocol) {
    case 'http:': {
      proxy = opts.httpProxy;
      break;
    }
    case 'https:': {
      proxy = opts.httpsProxy;
      break;
    }
  }

  if (typeof proxy === 'undefined' || proxy === '') {
    return undefined;
  }

  if (!proxy.includes('://')) {
    proxy = `${protocol}//${proxy}`;
  }

  if (typeof proxy !== 'string') {
    return proxy;
  }

  try {
    return new URL(proxy);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_err: unknown) {
    throw new PnpmError('INVALID_PROXY', "Couldn't parse proxy URL", {
      hint: 'If your proxy URL contains a username and password, make sure to URL-encode them (you may use the encodeURIComponent function). For instance, https-proxy=https://use%21r:pas%2As@my.proxy:1234/foo. Do not encode the colon (:) between the username and password.',
    });
  }
}

function getProxy(
  proxyUrl: URL,
  opts: {
    ca?: string | string[] | undefined;
    cert?: string | string[] | undefined;
    key?: string | undefined;
    timeout?: number | undefined;
    localAddress?: string | undefined;
    maxSockets?: number | undefined;
    strictSsl?: boolean | undefined;
  },
  isHttps: boolean
):
  | HttpProxyAgent<string>
  | PatchedHttpsProxyAgent
  | SocksProxyAgent
  | undefined {
  const proxyOptions = {
    auth: getAuth(proxyUrl),
    ca: opts.ca,
    cert: opts.cert,
    host: proxyUrl.hostname,
    key: opts.key,
    localAddress: opts.localAddress,
    maxSockets: opts.maxSockets ?? DEFAULT_MAX_SOCKETS,
    path: proxyUrl.pathname,
    port: Number.parseInt(proxyUrl.port, 10),
    protocol: proxyUrl.protocol,
    rejectUnauthorized: opts.strictSsl,
    timeout:
      typeof opts.timeout !== 'number' || opts.timeout === 0
        ? 0
        : opts.timeout + 1,
  };

  if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
    if (!isHttps) {
      return new HttpProxyAgent(proxyUrl, proxyOptions);
    }

    return new PatchedHttpsProxyAgent(proxyUrl, proxyOptions);
  }

  if (proxyUrl.protocol.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl, proxyOptions);
  }

  return undefined;
}

function getAuth(user: {
  username?: string | undefined;
  password?: string | undefined;
}): string | undefined {
  if (typeof user.username === 'undefined' || user.username === '') {
    return undefined;
  }

  let auth = user.username;

  if (typeof user.password === 'string' && user.password !== '') {
    auth += `:${user.password}`;
  }

  return decodeURIComponent(auth);
}

const extraOpts = Symbol('extra agent opts');

// This is a workaround for this issue: https://github.com/TooTallNate/node-https-proxy-agent/issues/89
export class PatchedHttpsProxyAgent extends HttpsProxyAgent<string> {
  constructor(uri: string | URL, opts: HttpProxyAgentOptions<string>) {
    super(uri, opts);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this[extraOpts] = opts;
  }

  callback(req: ClientRequest, opts: RequestOptions): unknown {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return super.callback(req, { ...this[extraOpts], ...opts });
  }
}
