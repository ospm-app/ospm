import type { ScopeLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import { map, take } from 'rxjs/operators';

const COMMANDS_THAT_REPORT_SCOPE = new Set([
  'install',
  'link',
  'prune',
  'rebuild',
  'remove',
  'unlink',
  'update',
  'run',
  'test',
]);

export function reportScope(
  scope$: Rx.Observable<ScopeLog>,
  opts: {
    isRecursive: boolean;
    cmd: string;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  if (!COMMANDS_THAT_REPORT_SCOPE.has(opts.cmd)) {
    return Rx.NEVER;
  }
  return scope$.pipe(
    take(1),
    map((log) => {
      if (log.selected === 1) {
        return Rx.NEVER;
      }
      let msg = 'Scope: ';

      if (log.selected === log.total) {
        msg += `all ${log.total}`;
      } else {
        msg += `${log.selected}`;
        if (typeof log.total === 'number' && log.total > 0) {
          msg += ` of ${log.total}`;
        }
      }

      if (
        typeof log.workspacePrefix === 'string' &&
        log.workspacePrefix !== ''
      ) {
        msg += ' workspace projects';
      } else {
        msg += ' projects';
      }

      return Rx.of({ msg });
    })
  );
}
