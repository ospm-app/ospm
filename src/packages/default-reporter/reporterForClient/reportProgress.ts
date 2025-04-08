import type { ProgressLog, StageLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import { filter, map, mapTo, takeWhile, startWith, take } from 'rxjs/operators';
import { hlValue } from './outputConstants.ts';
import { zoomOut } from './utils/zooming.ts';

type ProgressStats = {
  fetched: number;
  imported: number;
  resolved: number;
  reused: number;
};

type ModulesInstallProgress = {
  importingDone$: Rx.Observable<boolean>;
  progress$: Rx.Observable<ProgressStats>;
  requirer: string;
};

export type StatusMessage = {
  msg: string;
  fixed: boolean;
  done?: boolean | undefined;
};

export function reportProgress(
  log$: {
    progress: Rx.Observable<ProgressLog>;
    stage: Rx.Observable<StageLog>;
  },
  opts: {
    cwd: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throttle?: Rx.OperatorFunction<any, any> | undefined;
    hideAddedPkgsProgress?: boolean | undefined;
    hideProgressPrefix?: boolean | undefined;
  }
): Rx.Observable<Rx.Observable<StatusMessage>> {
  const progressOutput = throttledProgressOutput.bind(null, opts);

  return getModulesInstallProgress$(log$.stage, log$.progress).pipe(
    map(
      opts.hideProgressPrefix === true
        ? ({ importingDone$, progress$ }) =>
            progressOutput(importingDone$, progress$)
        : ({ importingDone$, progress$, requirer }) => {
            const output$ = progressOutput(importingDone$, progress$);

            if (requirer === opts.cwd) {
              return output$;
            }
            return output$.pipe(
              map((msg) => {
                msg['msg'] = zoomOut(opts.cwd, requirer, msg['msg']);
                return msg;
              })
            );
          }
    )
  );
}

function throttledProgressOutput(
  opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throttle?: Rx.OperatorFunction<any, any> | undefined;
    hideAddedPkgsProgress?: boolean | undefined;
  },
  importingDone$: Rx.Observable<boolean>,
  progress$: Rx.Observable<ProgressStats>
): Rx.Observable<StatusMessage> {
  const progress =
    opts.throttle != null ? progress$.pipe(opts.throttle) : progress$;

  const combinedProgress = Rx.combineLatest(progress, importingDone$)
    // Avoid logs after all resolved packages were downloaded.
    // Fixing issue: https://github.com/pnpm/pnpm/issues/1028#issuecomment-364782901
    .pipe(takeWhile(([, importingDone]) => !importingDone, true));
  return combinedProgress.pipe(
    map(
      opts.hideAddedPkgsProgress === true
        ? createStatusMessageWithoutAdded
        : createStatusMessage
    )
  );
}

function getModulesInstallProgress$(
  stage$: Rx.Observable<StageLog>,
  progress$: Rx.Observable<ProgressLog>
): Rx.Observable<ModulesInstallProgress> {
  const modulesInstallProgressPushStream =
    new Rx.Subject<ModulesInstallProgress>();
  const progressStatsPushStreamByRequirer =
    getProgressStatsPushStreamByRequirer(progress$);

  const stagePushStreamByRequirer: {
    [requirer: string]: Rx.Subject<StageLog>;
  } = {};
  // biome-ignore lint/complexity/noForEach: <explanation>
  stage$
    .forEach((log: StageLog) => {
      if (!stagePushStreamByRequirer[log.prefix]) {
        stagePushStreamByRequirer[log.prefix] = new Rx.Subject<StageLog>();
        if (!progressStatsPushStreamByRequirer[log.prefix]) {
          progressStatsPushStreamByRequirer[log.prefix] = new Rx.Subject();
        }

        modulesInstallProgressPushStream.next({
          importingDone$: stage$ToImportingDone$(
            Rx.from(stagePushStreamByRequirer[log.prefix] ?? [])
          ),
          progress$: Rx.from(
            progressStatsPushStreamByRequirer[log.prefix] ?? []
          ),
          requirer: log.prefix,
        });
      }

      const stagePushStream = stagePushStreamByRequirer[log.prefix];

      if (stagePushStream) {
        stagePushStream.next(log);

        if (log.stage === 'importing_done') {
          const progressStatsPushStream =
            progressStatsPushStreamByRequirer[log.prefix];

          if (progressStatsPushStream) {
            progressStatsPushStream.complete();
          }

          stagePushStream.complete();
        }
      }
    })
    .catch(() => {});

  return Rx.from(modulesInstallProgressPushStream);
}

function stage$ToImportingDone$(
  stage$: Rx.Observable<StageLog>
): Rx.Observable<boolean> {
  return stage$.pipe(
    filter((log: StageLog) => log.stage === 'importing_done'),
    mapTo(true),
    take(1),
    startWith(false)
  );
}

function getProgressStatsPushStreamByRequirer(
  progress$: Rx.Observable<ProgressLog>
): { [requirer: string]: Rx.Subject<ProgressStats> } {
  const progressStatsPushStreamByRequirer: {
    [requirer: string]: Rx.Subject<ProgressStats>;
  } = {};

  const previousProgressStatsByRequirer: { [requirer: string]: ProgressStats } =
    {};
  // biome-ignore lint/complexity/noForEach: <explanation>
  progress$
    .forEach((log: ProgressLog): void => {
      if (!previousProgressStatsByRequirer[log.requester]) {
        previousProgressStatsByRequirer[log.requester] = {
          fetched: 0,
          imported: 0,
          resolved: 0,
          reused: 0,
        };
      }

      const previousProgressStats =
        previousProgressStatsByRequirer[log.requester];

      if (typeof previousProgressStats !== 'undefined') {
        switch (log.status) {
          case 'resolved': {
            previousProgressStats.resolved++;
            break;
          }
          case 'fetched': {
            previousProgressStats.fetched++;
            break;
          }
          case 'found_in_store': {
            previousProgressStats.reused++;
            break;
          }
          case 'imported': {
            previousProgressStats.imported++;
            break;
          }
        }
      }

      if (!progressStatsPushStreamByRequirer[log.requester]) {
        progressStatsPushStreamByRequirer[log.requester] =
          new Rx.Subject<ProgressStats>();
      }

      if (typeof previousProgressStats !== 'undefined') {
        const progressStatsPushStream =
          progressStatsPushStreamByRequirer[log.requester];

        if (typeof progressStatsPushStream !== 'undefined') {
          progressStatsPushStream.next(previousProgressStats);
        }
      }
    })
    .catch(() => {});

  return progressStatsPushStreamByRequirer;
}

function createStatusMessage([progress, importingDone]: [
  ProgressStats,
  boolean,
]): StatusMessage {
  const msg = `Progress: resolved ${hlValue(
    progress.resolved.toString()
  )}, reused ${hlValue(progress.reused.toString())}, downloaded ${hlValue(
    progress.fetched.toString()
  )}, added ${hlValue(progress.imported.toString())}`;
  if (importingDone) {
    return {
      done: true,
      fixed: false,
      msg: `${msg}, done`,
    };
  }
  return {
    fixed: true,
    msg,
  };
}

function createStatusMessageWithoutAdded([progress, importingDone]: [
  ProgressStats,
  boolean,
]): StatusMessage {
  const msg = `Progress: resolved ${hlValue(
    progress.resolved.toString()
  )}, reused ${hlValue(progress.reused.toString())}, downloaded ${hlValue(
    progress.fetched.toString()
  )}`;
  if (importingDone) {
    return {
      done: true,
      fixed: false,
      msg: `${msg}, done`,
    };
  }
  return {
    fixed: true,
    msg,
  };
}
