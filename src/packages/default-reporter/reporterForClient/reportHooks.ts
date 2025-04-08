import type { HookLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import { map } from 'rxjs/operators';
import chalk from 'chalk';
import { autozoom } from './utils/zooming.ts';

export function reportHooks(
  hook$: Rx.Observable<HookLog>,
  opts: {
    cwd: string;
    isRecursive: boolean;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  return hook$.pipe(
    map((log) =>
      Rx.of({
        msg: autozoom(
          opts.cwd,
          log.prefix,
          `${chalk.magentaBright(log.hook)}: ${log.message}`,
          {
            zoomOutCurrent: opts.isRecursive,
          }
        ),
      })
    )
  );
}
