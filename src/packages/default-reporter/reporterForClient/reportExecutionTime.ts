import prettyMs from 'pretty-ms';
import { packageManager } from '../../cli-meta/index.ts';
import type { ExecutionTimeLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import { map, take } from 'rxjs/operators';

export function reportExecutionTime(
  executionTime$: Rx.Observable<ExecutionTimeLog>
): Rx.Observable<Rx.Observable<{ fixed: boolean; msg: string }>> {
  return executionTime$.pipe(
    take(1),
    map((log) => {
      return Rx.of({
        fixed: true, // Without this, for some reason sometimes the progress bar is printed after the execution time
        msg: `Done in ${prettyMs(log.endedAt - log.startedAt)} using ${packageManager.name} v${packageManager.version}`,
      });
    })
  );
}
