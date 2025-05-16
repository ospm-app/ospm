import { promises as fs } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { OspmError } from '../error/index.ts';
import { sync as canWriteToDir } from 'can-write-to-dir';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PATH from 'path-name';

export async function checkGlobalBinDir(
  globalBinDir: string,
  {
    env,
    shouldAllowWrite,
  }: {
    env: Record<string, string | undefined>;
    shouldAllowWrite?: boolean | undefined;
  }
): Promise<void> {
  if (typeof env[PATH] === 'undefined') {
    throw new OspmError(
      'NO_PATH_ENV',
      `Couldn't find a global directory for executables because the "${PATH}" environment variable is not set.`
    );
  }

  if (!(await globalBinDirIsInPath(globalBinDir, env))) {
    throw new OspmError(
      'GLOBAL_BIN_DIR_NOT_IN_PATH',
      `The configured global bin directory "${globalBinDir}" is not in PATH`
    );
  }

  if (shouldAllowWrite === true && !canWriteToDirAndExists(globalBinDir)) {
    throw new OspmError(
      'OSPM_DIR_NOT_WRITABLE',
      `The CLI has no write access to the ospm home directory at ${globalBinDir}`
    );
  }
}

async function globalBinDirIsInPath(
  globalBinDir: string,
  env: Record<string, string | undefined>
): Promise<boolean> {
  const dirs = env[PATH]?.split(path.delimiter) ?? [];

  if (dirs.some((dir) => areDirsEqual(globalBinDir, dir))) {
    return true;
  }

  const realGlobalBinDir = await fs.realpath(globalBinDir);

  return dirs.some((dir) => areDirsEqual(realGlobalBinDir, dir));
}

function areDirsEqual(dir1: string, dir2: string): boolean {
  return path.relative(dir1, dir2) === '';
}

function canWriteToDirAndExists(dir: string): boolean {
  try {
    return canWriteToDir(dir);
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return false;
    }

    throw err;
  }
}
