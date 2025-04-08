import type { SkippedOptionalDependencyLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import { filter, map } from 'rxjs/operators';

export function reportSkippedOptionalDependencies(
  skippedOptionalDependency$: Rx.Observable<SkippedOptionalDependencyLog>,
  opts: {
    cwd: string;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  return skippedOptionalDependency$.pipe(
    filter((log: SkippedOptionalDependencyLog): boolean => {
      return Boolean(
        log.prefix === opts.cwd && log.parents && log.parents.length === 0
      );
    }),
    map((log: SkippedOptionalDependencyLog): Rx.Observable<{ msg: string }> => {
      return Rx.of({
        msg: `info: ${
          (
            'id' in log.package
              ? log.package.id
              : typeof log.package.name === 'string'
                ? `${log.package.name}@${log.package.version}`
                : undefined
          ) ??
          log.package.pref ??
          ''
        } is an optional dependency and failed compatibility check. Excluding it from installation.`,
      });
    })
  );
}
