// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nerfDart from 'nerf-dart';
import {
  getAuthHeadersFromConfig,
  loadToken,
} from './getAuthHeadersFromConfig.ts';
import type {
  ConfigSettings,
  AuthHeadersByURI,
} from './getAuthHeadersFromConfig.ts';
import { removePort } from './helpers/removePort.ts';

export { loadToken };

type AuthHeaderFunction = (uri: string) => string | undefined;

type CreateAuthHeaderOptions = {
  allSettings: ConfigSettings;
  userSettings?: ConfigSettings | undefined;
};

export function createGetAuthHeaderByURI(
  opts: CreateAuthHeaderOptions
): AuthHeaderFunction {
  const authHeaders = getAuthHeadersFromConfig({
    allSettings: opts.allSettings,
    userSettings: opts.userSettings ?? {},
  });

  if (Object.keys(authHeaders).length === 0) {
    return (uri: string): string | undefined => {
      return basicAuth(new URL(uri));
    };
  }

  return getAuthHeaderByURI.bind(
    null,
    authHeaders,
    getMaxParts(Object.keys(authHeaders))
  );
}

function getMaxParts(uris: string[]): number {
  return uris.reduce((max, uri) => {
    const parts = uri.split('/').length;

    return parts > max ? parts : max;
  }, 0);
}

function getAuthHeaderByURI(
  authHeaders: AuthHeadersByURI,
  maxParts: number,
  uri: string
): string | undefined {
  let newUrl = uri;

  if (!uri.endsWith('/')) {
    newUrl += '/';
  }

  const parsedUri = new URL(newUrl);

  const basic = basicAuth(parsedUri);

  if (typeof basic === 'string') {
    return basic;
  }

  const nerfed = nerfDart(newUrl);

  const parts = nerfed.split('/');

  for (let i = Math.min(parts.length, maxParts) - 1; i >= 3; i--) {
    const key = `${parts.slice(0, i).join('/')}/`;

    if (typeof authHeaders[key] !== 'undefined') {
      return authHeaders[key];
    }
  }

  const urlWithoutPort = removePort(parsedUri);

  if (urlWithoutPort !== newUrl) {
    return getAuthHeaderByURI(authHeaders, maxParts, urlWithoutPort);
  }

  return undefined;
}

function basicAuth(uri: URL): string | undefined {
  if (!uri.username && !uri.password) {
    return undefined;
  }

  const auth64 = btoa(`${uri.username}:${uri.password}`);

  return `Basic ${auth64}`;
}
