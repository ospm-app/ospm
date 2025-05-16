import type { Config } from '../config/index.ts';
import type { Log } from '../core-loggers/index.ts';
import type * as Rx from 'rxjs';
import chalk from 'chalk';
import { reportError } from './reportError.ts';

export function reporterForServer(
  log$: Rx.Observable<Log>,
  config?: Config | undefined
): Rx.Subscription {
  return log$.subscribe({
    complete: () => undefined,
    error: () => undefined,
    next(log) {
      if (log.name === 'ospm:fetching-progress') {
        console.info(
          `${chalk.cyan(`fetching_${log.status}`)} ${log.packageId}`
        );

        return;
      }

      switch (log.level) {
        case 'warn': {
          console.info(formatWarn(log.message));
          return;
        }

        case 'error': {
          console.info(reportError(log, config));
          return;
        }

        case 'debug': {
          return;
        }

        default: {
          console.info(log.message);
        }
      }
    },
  });
}

function formatWarn(message: string): string {
  // The \u2009 is the "thin space" unicode character
  // It is used instead of ' ' because chalk (as of version 2.1.0)
  // trims whitespace at the beginning
  return `${chalk.bgYellow.black('\u2009WARN\u2009')} ${message}`;
}
