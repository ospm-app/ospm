import { OspmError } from '../error/index.ts';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nerfDart from 'nerf-dart';

export type ConfigValue = string;

export type ConfigSettings = {
  [key: string]: ConfigValue | undefined;
};

export type AuthHeadersByURI = {
  [uri: string]: string;
};

type GetAuthHeadersConfig = {
  allSettings: ConfigSettings;
  userSettings: ConfigSettings;
};

export function getAuthHeadersFromConfig({
  allSettings,
  userSettings,
}: GetAuthHeadersConfig): AuthHeadersByURI {
  const authHeaderValueByURI: AuthHeadersByURI = {};

  for (const [key, value] of Object.entries(allSettings)) {
    const [uri, authType] = splitKey(key);

    if (typeof uri === 'undefined' || typeof authType === 'undefined') {
      continue;
    }

    switch (authType) {
      case '_authToken': {
        authHeaderValueByURI[uri] = `Bearer ${value}`;

        continue;
      }

      case '_auth': {
        authHeaderValueByURI[uri] = `Basic ${value}`;

        continue;
      }

      case 'username': {
        if (`${uri}:_password` in allSettings) {
          const password = Buffer.from(
            allSettings[`${uri}:_password`] ?? '',
            'base64'
          ).toString('utf8');

          authHeaderValueByURI[uri] =
            `Basic ${Buffer.from(`${value}:${password}`).toString('base64')}`;

          continue;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(userSettings)) {
    const [uri, authType] = splitKey(key);

    if (
      typeof uri === 'undefined' ||
      typeof authType === 'undefined' ||
      typeof value === 'undefined'
    ) {
      continue;
    }

    if (authType === 'tokenHelper') {
      authHeaderValueByURI[uri] = loadToken(value, key);
    }
  }

  const registry =
    typeof allSettings['registry'] === 'undefined'
      ? '//registry.npmjs.org/'
      : nerfDart(allSettings['registry']);

  if (typeof userSettings['tokenHelper'] !== 'undefined') {
    authHeaderValueByURI[registry] = loadToken(
      userSettings['tokenHelper'],
      'tokenHelper'
    );
  } else if (typeof allSettings['_authToken'] !== 'undefined') {
    authHeaderValueByURI[registry] = `Bearer ${allSettings['_authToken']}`;
  } else if (typeof allSettings['_auth'] !== 'undefined') {
    authHeaderValueByURI[registry] = `Basic ${allSettings['_auth']}`;
  } else if (
    typeof allSettings['_password'] !== 'undefined' &&
    typeof allSettings['username'] !== 'undefined'
  ) {
    authHeaderValueByURI[registry] =
      `Basic ${Buffer.from(`${allSettings.username}:${allSettings['_password']}`).toString('base64')}`;
  }
  return authHeaderValueByURI;
}

function splitKey(key: string): string[] {
  const index = key.lastIndexOf(':');

  if (index === -1) {
    return [key, ''];
  }

  return [key.slice(0, index), key.slice(index + 1)];
}

export function loadToken(
  helperPath: ConfigValue,
  settingName: string
): string {
  if (!path.isAbsolute(helperPath) || !fs.existsSync(helperPath)) {
    throw new OspmError(
      'BAD_TOKEN_HELPER_PATH',
      `${settingName} must be an absolute path, without arguments`
    );
  }

  const spawnResult = spawnSync(helperPath, { shell: true });

  if (spawnResult.status !== 0) {
    throw new OspmError(
      'TOKEN_HELPER_ERROR_STATUS',
      `Error running "${helperPath}" as a token helper, configured as ${settingName}. Exit code ${spawnResult.status?.toString() ?? ''}`
    );
  }
  return spawnResult.stdout.toString('utf8').trimEnd();
}
