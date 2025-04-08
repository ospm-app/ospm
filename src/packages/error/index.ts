import { WANTED_LOCKFILE } from '../constants/index.ts';

export class PnpmError extends Error {
  readonly code: string;
  readonly hint?: string | undefined;
  attempts?: number | undefined;
  prefix?: string | undefined;
  pkgsStack?: Array<{ id: string; name: string; version: string }> | undefined;
  constructor(
    code: string,
    message: string,
    opts?:
      | {
          attempts?: number | undefined;
          hint?: string | undefined;
        }
      | undefined
  ) {
    super(message);
    this.code = code.startsWith('ERR_PNPM_') ? code : `ERR_PNPM_${code}`;
    this.hint = opts?.hint;
    this.attempts = opts?.attempts;
  }
}

export type FetchErrorResponse = {
  status: number;
  statusText: string;
};

export type FetchErrorRequest = {
  url: string;
  authHeaderValue?: string | undefined;
};

export class FetchError extends PnpmError {
  readonly response: FetchErrorResponse;
  readonly request: FetchErrorRequest;

  constructor(
    request: FetchErrorRequest,
    response: FetchErrorResponse,
    hint?: string | undefined
  ) {
    const _request: FetchErrorRequest = {
      url: request.url,
    };

    if (
      typeof request.authHeaderValue === 'string' &&
      request.authHeaderValue !== ''
    ) {
      _request.authHeaderValue = hideAuthInformation(request.authHeaderValue);
    }

    const message = `GET ${request.url}: ${response.statusText} - ${response.status}`;

    let h = '';
    // NOTE: For security reasons, some registries respond with 404 on authentication errors as well.
    // So we print authorization info on 404 errors as well.
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      h = typeof hint === 'string' ? `${hint}\n\n` : '';

      h +=
        typeof _request.authHeaderValue === 'string' &&
        _request.authHeaderValue !== ''
          ? `An authorization header was used: ${_request.authHeaderValue}`
          : 'No authorization header was set for the request.';
    }

    super(`FETCH_${response.status}`, message, { hint: h });
    this.request = _request;
    this.response = response;
  }
}

function hideAuthInformation(authHeaderValue: string): string {
  const [authType, token] = authHeaderValue.split(' ');

  if (token == null) {
    return '[hidden]';
  }

  if (token.length < 20) {
    return `${authType} [hidden]`;
  }

  return `${authType} ${token.substring(0, 4)}[hidden]`;
}

export class LockfileMissingDependencyError extends PnpmError {
  constructor(depPath: string) {
    const message = `Broken lockfile: no entry for '${depPath}' in ${WANTED_LOCKFILE}`;
    super('LOCKFILE_MISSING_DEPENDENCY', message, {
      hint:
        'This issue is probably caused by a badly resolved merge conflict.\n' +
        "To fix the lockfile, run 'pnpm install --no-frozen-lockfile'.",
    });
  }
}
