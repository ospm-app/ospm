import type { UpdateCheckLog } from '../../core-loggers/index.ts';
import {
  detectIfCurrentPkgIsExecutable,
  isExecutedByCorepack,
} from '../../cli-meta/index.ts';
import boxen from '@zkochan/boxen';
import chalk from 'chalk';
import * as Rx from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import semver from 'semver';

export function reportUpdateCheck(
  log$: Rx.Observable<UpdateCheckLog>,
  opts: {
    env: NodeJS.ProcessEnv;
    process: NodeJS.Process;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  return log$.pipe(
    take(1),
    filter((log: UpdateCheckLog): boolean => {
      return semver.gt(log.latestVersion, log.currentVersion);
    }),
    map((log: UpdateCheckLog): Rx.Observable<{ msg: string }> => {
      const updateMessage = renderUpdateMessage({
        currentPkgIsExecutable: detectIfCurrentPkgIsExecutable(opts.process),
        latestVersion: log.latestVersion,
        env: opts.env,
      });

      return Rx.of({
        msg: boxen(
          `\
Update available! ${chalk.red(log.currentVersion)} → ${chalk.green(log.latestVersion)}.
${chalk.magenta('Changelog:')} https://github.com/pnpm/pnpm/releases/tag/v${log.latestVersion}
${updateMessage}`,
          {
            padding: 1,
            margin: 1,
            align: 'center',
            borderColor: 'yellow',
            borderStyle: 'round',
          }
        ),
      });
    })
  );
}

interface UpdateMessageOptions {
  currentPkgIsExecutable: boolean;
  env: NodeJS.ProcessEnv;
  latestVersion: string;
}

function renderUpdateMessage(opts: UpdateMessageOptions): string {
  const updateCommand = renderUpdateCommand(opts);
  return `Run "${chalk.magenta(updateCommand)}" to update.`;
}

function renderUpdateCommand(opts: UpdateMessageOptions): string {
  if (isExecutedByCorepack(opts.env)) {
    return `corepack use pnpm@${opts.latestVersion}`;
  }

  if (typeof opts.env.PNPM_HOME === 'string') {
    return 'pnpm self-update';
  }

  const pkgName = opts.currentPkgIsExecutable ? '@pnpm/exe' : 'pnpm';
  return `pnpm add -g ${pkgName}`;
}
