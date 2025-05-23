import path from 'node:path';
import util from 'node:util';
import camelcaseKeys from 'camelcase-keys';
import { envReplace } from '@pnpm/config.env-replace';
import { readIniFile } from 'read-ini-file';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { parseField } from '@pnpm/npm-conf/lib/util';
import { types } from './types.ts';
import process from 'node:process';
import type { ModulesDir } from '../types/project.ts';

export type LocalConfig = Record<string, string> & {
  modulesDir?: ModulesDir | undefined;
  hoist?: boolean | undefined;
};

export async function readLocalConfig(prefix: string): Promise<LocalConfig> {
  try {
    const ini = (await readIniFile(path.join(prefix, '.npmrc'))) as Record<
      string,
      string
    >;

    for (let [key, val] of Object.entries(ini)) {
      if (typeof val === 'string') {
        try {
          key = envReplace(key, process.env);

          ini[key] = parseField(
            types,
            envReplace(val, process.env),
            key
          ) as string;
        } catch {}
      }
    }

    // TODO: valibot schema
    const config = camelcaseKeys(ini) as LocalConfig;

    if (typeof config.shamefullyFlatten === 'string') {
      config.hoistPattern = '*';
      // TODO: print a warning
    }

    if (config.hoist === false) {
      config.hoistPattern = '';
    }

    return config;
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return {};
    }

    throw err;
  }
}
