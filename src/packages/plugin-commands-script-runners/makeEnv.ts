import { PnpmError } from '../error/index.ts';
import { prependDirsToPath } from '../env.path/index.ts';
import path from 'node:path';
import process from 'node:process';

export interface Env extends NodeJS.ProcessEnv {
  npm_config_user_agent: string;
  PATH?: string | undefined;
  Path?: string | undefined;
}

export function makeEnv(opts: {
  extraEnv?: NodeJS.ProcessEnv | undefined;
  userAgent?: string | undefined;
  prependPaths: string[];
}): Env {
  for (const prependPath of opts.prependPaths) {
    if (prependPath.includes(path.delimiter)) {
      // Unfortunately, there is no way to escape the PATH delimiter,
      // so directories added to the PATH should not contain it.
      throw new PnpmError(
        'BAD_PATH_DIR',
        `Cannot add ${prependPath} to PATH because it contains the path delimiter character (${path.delimiter})`
      );
    }
  }

  const pathEnv = prependDirsToPath(opts.prependPaths);

  return {
    ...process.env,
    ...opts.extraEnv,
    npm_config_user_agent: opts.userAgent ?? 'pnpm',
    [pathEnv.name]: pathEnv.value,
  };
}
