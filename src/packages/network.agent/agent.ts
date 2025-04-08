import { URL } from 'node:url';
import { HttpsAgent, HttpAgent } from 'agentkeepalive';
import * as LRU from 'lru-cache';
import { getProxyAgent } from '../network.proxy-agent/index.ts';
import { pickSettingByUrl } from '../network.config/index.ts';
import type { HttpProxyAgent } from 'http-proxy-agent';
import type { PatchedHttpsProxyAgent } from '../network.proxy-agent/proxy-agent.ts';
import type { SocksProxyAgent } from 'socks-proxy-agent';

const DEFAULT_MAX_SOCKETS = 50;

const AGENT_CACHE = new LRU.LRUCache<string, HttpsAgent | HttpAgent>({
  max: 50,
});

export type AgentOptions = {
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

export function getAgent(
  uri: string,
  opts: AgentOptions
):
  | HttpProxyAgent<string>
  | PatchedHttpsProxyAgent
  | SocksProxyAgent
  | HttpsAgent
  | HttpAgent
  | undefined {
  if (
    (typeof opts.httpProxy === 'string' ||
      typeof opts.httpsProxy === 'string') &&
    !checkNoProxy(uri, opts)
  ) {
    const proxyAgent = getProxyAgent(uri, opts);

    if (proxyAgent) {
      return proxyAgent;
    }
  }

  return getNonProxyAgent(uri, opts);
}

function getNonProxyAgent(
  uri: string,
  opts: AgentOptions
): HttpsAgent | HttpAgent | undefined {
  const parsedUri = new URL(uri);

  const isHttps = parsedUri.protocol === 'https:';

  const {
    ca,
    cert,
    key: certKey,
  } = {
    ...opts,
    ...pickSettingByUrl(opts.clientCertificates, uri),
  };

  const key = [
    `https:${isHttps.toString()}`,
    `local-address:${opts.localAddress ?? '>no-local-address<'}`,
    `strict-ssl:${
      isHttps ? Boolean(opts.strictSsl).toString() : '>no-strict-ssl<'
    }`,
    `ca:${(isHttps && ca?.toString()) ?? '>no-ca<'}`,
    `cert:${(isHttps && cert?.toString()) ?? '>no-cert<'}`,
    `key:${(isHttps && certKey?.toString()) ?? '>no-key<'}`,
  ].join(':');

  if (typeof AGENT_CACHE.peek(key) !== 'undefined') {
    return AGENT_CACHE.get(key);
  }

  // If opts.timeout is zero, set the agentTimeout to zero as well. A timeout
  // of zero disables the timeout behavior (OS limits still apply). Else, if
  // opts.timeout is a non-zero value, set it to timeout + 1, to ensure that
  // the node-fetch-npm timeout will always fire first, giving us more
  // consistent errors.
  const agentTimeout =
    typeof opts.timeout !== 'number' || opts.timeout === 0
      ? 0
      : opts.timeout + 1;

  // NOTE: localAddress is passed to the agent here even though it is an
  // undocumented option of the agent's constructor.
  //
  // This works because all options of the agent are merged with
  // all options of the request:
  // https://github.com/nodejs/node/blob/350a95b89faab526de852d417bbb8a3ac823c325/lib/_http_agent.js#L254
  const agent = isHttps
    ? new HttpsAgent({
        ca,
        cert,
        key: certKey,
        localAddress: opts.localAddress,
        maxSockets: opts.maxSockets ?? DEFAULT_MAX_SOCKETS,
        rejectUnauthorized: opts.strictSsl,
        timeout: agentTimeout,
      } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    : new HttpAgent({
        localAddress: opts.localAddress,
        maxSockets: opts.maxSockets ?? DEFAULT_MAX_SOCKETS,
        timeout: agentTimeout,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  AGENT_CACHE.set(key, agent);

  return agent;
}

function checkNoProxy(
  uri: string,
  opts: { noProxy?: boolean | string | undefined }
): boolean {
  const host = new URL(uri).hostname
    .split('.')
    .filter((x) => x)
    .reverse();
  if (typeof opts.noProxy === 'string') {
    const noproxyArr = opts.noProxy.split(/\s*,\s*/g);
    return noproxyArr.some((no) => {
      const noParts = no
        .split('.')
        .filter((x) => x)
        .reverse();
      if (noParts.length === 0) {
        return false;
      }
      for (let i = 0; i < noParts.length; i++) {
        if (host[i] !== noParts[i]) {
          return false;
        }
      }
      return true;
    });
  }
  return opts.noProxy ?? false;
}
