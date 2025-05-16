import fs from 'node:fs';
import path from 'node:path';
import { getCurrentPackageName } from '../cli-meta/index.ts';
import { runOspmCli } from '../exec.pnpm-cli-runner/index.ts';
import { getToolDirPath } from '../tools.path/index.ts';
import { sync as rimraf } from '@zkochan/rimraf';
import { fastPathTemp as pathTemp } from 'path-temp';
import renameOverwrite from 'rename-overwrite';
import type { SelfUpdateCommandOptions } from './selfUpdate.ts';

export interface installOspmToToolsResult {
  binDir: string;
  baseDir: string;
  alreadyExisted: boolean;
}

export async function installOspmToTools(
  ospmVersion: string,
  opts: SelfUpdateCommandOptions
): Promise<installOspmToToolsResult> {
  const currentPkgName = getCurrentPackageName();

  const dir = getToolDirPath({
    ospmHomeDir: opts.ospmHomeDir,
    tool: {
      name: currentPkgName,
      version: ospmVersion,
    },
  });

  const binDir = path.join(dir, 'bin');

  const alreadyExisted = fs.existsSync(binDir);

  if (alreadyExisted) {
    return {
      alreadyExisted,
      baseDir: dir,
      binDir,
    };
  }

  const stage = pathTemp(dir);

  fs.mkdirSync(stage, { recursive: true });

  fs.writeFileSync(path.join(stage, 'package.json'), '{}');

  try {
    // The reason we don't just run add.handler is that at this point we might have settings from local config files
    // that we don't want to use while installing the ospm CLI.
    runOspmCli(
      [
        'add',
        `${currentPkgName}@${ospmVersion}`,
        '--loglevel=error',
        '--allow-build=@ospm/exe',
        // We want to avoid symlinks because of the rename step,
        // which breaks the junctions on Windows.
        '--config.node-linker=hoisted',
        `--config.bin=${path.join(stage, 'bin')}`,
      ],
      { cwd: stage }
    );
    renameOverwrite.sync(stage, dir);
  } catch (err: unknown) {
    try {
      rimraf(stage);
    } catch {} // eslint-disable-line:no-empty
    throw err;
  }
  return {
    alreadyExisted,
    baseDir: dir,
    binDir,
  };
}
