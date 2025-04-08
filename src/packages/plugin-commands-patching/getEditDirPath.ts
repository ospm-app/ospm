import path from 'node:path';
import type { ParseWantedDependencyResult } from '../parse-wanted-dependency/index.ts';

export type GetEditDirOptions = {
  modulesDir: string;
};

export function getEditDirPath(
  param: string,
  patchedDep: ParseWantedDependencyResult,
  opts: GetEditDirOptions
): string {
  return path.join(
    opts.modulesDir,
    '.pnpm_patches',
    getEditDirNameFromParsedDep(patchedDep) ?? param
  );
}

function getEditDirNameFromParsedDep(
  patchedDep: ParseWantedDependencyResult
): string | undefined {
  if (
    typeof patchedDep.alias === 'string' &&
    typeof patchedDep.pref === 'string'
  ) {
    const pref = patchedDep.pref.replace(/["*/:<>?\\|]+/g, '+');

    return `${patchedDep.alias}@${pref}`;
  }

  if (typeof patchedDep.alias === 'string') {
    return patchedDep.alias;
  }

  return undefined;
}
