import path from 'node:path';
import { spawnSync } from 'node:child_process';
import camelcaseKeys from 'camelcase-keys';
import fs from 'node:fs';

export type Person = {
  name?: string | undefined;
  email?: string | undefined;
  url?: string | undefined;
  web?: string | undefined;
  mail?: string | undefined;
};

export function personToString(person: Person): string {
  const name = person.name ?? '';

  const u = person.url ?? person.web;

  const url = typeof u === 'string' ? ` (${u})` : '';

  const e = person.email ?? person.mail;

  const email = typeof e === 'string' ? ` <${e}>` : '';

  return name + email + url;
}

export function workWithInitModule(
  localConfig: Record<string, string>
): Record<string, string> {
  const { initModule, ...restConfig } = localConfig;

  if (typeof initModule === 'string') {
    const filePath = path.resolve(initModule);

    const isFileExist = fs.existsSync(filePath);

    if (['.js', '.cjs'].includes(path.extname(filePath)) && isFileExist) {
      spawnSync('node', [filePath], {
        stdio: 'inherit',
      });
    }
  }

  return restConfig;
}

export function workWithInitConfig(
  localConfig: Record<string, string>
): Record<string, string> {
  const packageJson: Record<string, string> = {};

  const authorInfo: Record<string, string> = {};

  for (const localConfigKey in localConfig) {
    if (
      localConfigKey.startsWith('init') &&
      localConfigKey !== 'initPackageManager'
    ) {
      const pureKey = localConfigKey.replace('init', '');

      const value = localConfig[localConfigKey];

      if (typeof value !== 'string') {
        continue;
      }

      if (pureKey.startsWith('Author')) {
        authorInfo[pureKey.replace('Author', '')] = value;
      } else {
        packageJson[pureKey] = value;
      }
    }
  }

  const author = personToString(camelcaseKeys(authorInfo));
  if (author) {
    packageJson.author = author;
  }
  return camelcaseKeys(packageJson);
}

export async function parseRawConfig(
  rawConfig: Record<string, string>
): Promise<Record<string, string>> {
  return workWithInitConfig(workWithInitModule(camelcaseKeys(rawConfig)));
}
