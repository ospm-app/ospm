import fs from 'node:fs';
import path from 'node:path';
import { detectIfCurrentPkgIsExecutable } from '../cli-meta/index.ts';
import { docsUrl } from '../cli-utils/index.ts';
import { logger } from '../logger/index.ts';
import {
  addDirToEnvPath,
  type ConfigReport,
  type PathExtenderReport,
} from '@pnpm/os.env.path-extender';
import renderHelp from 'render-help';
import rimraf from '@zkochan/rimraf';

export function rcOptionsTypes(): Record<string, unknown> {
  return {};
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    force: Boolean,
  };
}

export const shorthands = {};

export const commandNames = ['setup'];

export function help(): string {
  return renderHelp({
    description: 'Sets up ospm',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Override the OSPM_HOME env variable in case it already exists',
            name: '--force',
            shortAlias: '-f',
          },
        ],
      },
    ],
    url: docsUrl('setup'),
    usages: ['ospm setup'],
  });
}

function getExecPath(): string {
  if (detectIfCurrentPkgIsExecutable()) {
    // If the ospm CLI was bundled by vercel/pkg then we cannot use the js path for npm_execpath
    // because in that case the js is in a virtual filesystem inside the executor.
    // Instead, we use the path to the exe file.
    return process.execPath;
  }

  return require.main != null ? require.main.filename : process.cwd();
}

function copyCli(currentLocation: string, targetDir: string): void {
  const newExecPath = path.join(targetDir, path.basename(currentLocation));

  if (path.relative(newExecPath, currentLocation) === '') return;

  logger.info({
    message: `Copying ospm CLI from ${currentLocation} to ${newExecPath}`,
    prefix: process.cwd(),
  });

  fs.mkdirSync(targetDir, { recursive: true });

  rimraf.sync(newExecPath);

  fs.copyFileSync(currentLocation, newExecPath);
}

function createPnpxScripts(targetDir: string): void {
  // Why script files instead of aliases?
  // 1. Aliases wouldn't work on all platform, such as Windows Command Prompt or POSIX `sh`.
  // 2. Aliases wouldn't work on all environments, such as non-interactive shells and CI environments.
  // 3. Aliases must be set for different shells while script files are limited to only 2 types: POSIX and Windows.
  // 4. Aliases cannot be located with the `which` or `where` command.
  // 5. Editing rc files is more error-prone than just write new files to the filesystem.

  fs.mkdirSync(targetDir, { recursive: true });

  // windows can also use shell script via mingw or cygwin so no filter
  const shellScript = ['#!/bin/sh', 'exec ospm dlx "$@"'].join('\n');

  fs.writeFileSync(path.join(targetDir, 'pnpx'), shellScript, { mode: 0o755 });

  if (process.platform === 'win32') {
    const batchScript = ['@echo off', 'ospm dlx %*'].join('\n');

    fs.writeFileSync(path.join(targetDir, 'pnpx.cmd'), batchScript);

    const powershellScript = 'ospm dlx @args';

    fs.writeFileSync(path.join(targetDir, 'pnpx.ps1'), powershellScript);
  }
}

export async function handler(opts: {
  force?: boolean | undefined;
  ospmHomeDir: string;
}): Promise<string> {
  const execPath = getExecPath();

  if (execPath.match(/\.[cm]?js$/) == null) {
    copyCli(execPath, opts.ospmHomeDir);

    createPnpxScripts(opts.ospmHomeDir);
  }

  try {
    const report = await addDirToEnvPath(opts.ospmHomeDir, {
      configSectionName: 'ospm',
      proxyVarName: 'OSPM_HOME',
      overwrite: opts.force ?? false,
      position: 'start',
    });

    return renderSetupOutput(report);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    switch (err.code) {
      case 'ERR_OSPM_BAD_ENV_FOUND': {
        err.hint =
          'If you want to override the existing env variable, use the --force option';
        break;
      }

      case 'ERR_OSPM_BAD_SHELL_SECTION': {
        err.hint =
          'If you want to override the existing configuration section, use the --force option';
        break;
      }
    }

    throw err;
  }
}

function renderSetupOutput(report: PathExtenderReport): string {
  if (report.oldSettings === report.newSettings) {
    return 'No changes to the environment were made. Everything is already up to date.';
  }

  const output = [];

  if (typeof report.configFile !== 'undefined') {
    output.push(reportConfigChange(report.configFile));
  }

  output.push(`Next configuration changes were made: ${report.newSettings}`);

  if (report.configFile == null) {
    output.push('Setup complete. Open a new terminal to start using ospm.');
  } else if (report.configFile.changeType !== 'skipped') {
    output.push(`To start using ospm, run: source ${report.configFile.path}`);
  }

  return output.join('\n\n');
}

function reportConfigChange(configReport: ConfigReport): string {
  switch (configReport.changeType) {
    case 'created': {
      return `Created ${configReport.path}`;
    }

    case 'appended': {
      return `Appended new lines to ${configReport.path}`;
    }

    case 'modified': {
      return `Replaced configuration in ${configReport.path}`;
    }

    case 'skipped': {
      return `Configuration already up to date in ${configReport.path}`;
    }
  }
}
