import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PATH from 'path-name';
import process from 'node:process';

export interface PrependDirsToPathResult {
  name: string;
  value: string;
  updated: boolean;
}

export function prependDirsToPath(
  prependDirs: string[],
  env = process.env
): PrependDirsToPathResult {
  const prepend = prependDirs.join(path.delimiter);
  const envPath = env[PATH];
  if (
    envPath != null &&
    (envPath === prepend || envPath.startsWith(`${prepend}${path.delimiter}`))
  ) {
    return {
      name: PATH,
      value: envPath,
      updated: false,
    };
  }
  return {
    name: PATH,
    value: [prepend, ...(envPath != null ? [envPath] : [])].join(
      path.delimiter
    ),
    updated: true,
  };
}
