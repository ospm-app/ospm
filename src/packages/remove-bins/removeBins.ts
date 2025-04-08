import path from 'node:path';
import { removalLogger } from '../core-loggers/index.ts';
import { getBinsFromPackageManifest } from '../package-bins/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import type { DependencyManifest } from '../types/index.ts';
import rimraf from '@zkochan/rimraf';
import CMD_EXTENSION from 'cmd-extension';
import isWindows from 'is-windows';

async function removeOnWin(cmd: string): Promise<void> {
  removalLogger.debug(cmd);

  await Promise.all([
    rimraf(cmd),
    rimraf(`${cmd}.ps1`),
    rimraf(`${cmd}${CMD_EXTENSION}`),
  ]);
}

async function removeOnNonWin(p: string): Promise<void> {
  removalLogger.debug(p);
  return rimraf(p);
}

export const removeBin: (cmd: string) => Promise<void> = isWindows()
  ? removeOnWin
  : removeOnNonWin;

export async function removeBinsOfDependency(
  dependencyDir: string,
  opts: {
    dryRun?: boolean | undefined;
    binsDir: string;
  }
): Promise<DependencyManifest | undefined> {
  const uninstalledPkgJson = await safeReadPackageJsonFromDir(dependencyDir);

  if (uninstalledPkgJson === null) {
    return;
  }

  const cmds = await getBinsFromPackageManifest(
    uninstalledPkgJson,
    dependencyDir
  );

  if (opts.dryRun !== true) {
    await Promise.all(
      cmds.map((cmd) => path.join(opts.binsDir, cmd.name)).map(removeBin)
    );
  }

  return uninstalledPkgJson;
}
