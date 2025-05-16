import type { Config } from '../../config/index.ts';
import type * as logs from '../../core-loggers/index.ts';
import type { LogLevel } from '../../logger/index.ts';
import type * as Rx from 'rxjs';
import { throttleTime } from 'rxjs/operators';
import { reportBigTarballProgress } from './reportBigTarballsProgress.ts';
import { reportContext } from './reportContext.ts';
import { reportExecutionTime } from './reportExecutionTime.ts';
import { reportDeprecations } from './reportDeprecations.ts';
import { reportHooks } from './reportHooks.ts';
import { reportInstallChecks } from './reportInstallChecks.ts';
import { reportLifecycleScripts } from './reportLifecycleScripts.ts';
import { reportMisc, LOG_LEVEL_NUMBER } from './reportMisc.ts';
import { reportPeerDependencyIssues } from './reportPeerDependencyIssues.ts';
import { reportProgress } from './reportProgress.ts';
import { reportRequestRetry } from './reportRequestRetry.ts';
import { reportScope } from './reportScope.ts';
import { reportSkippedOptionalDependencies } from './reportSkippedOptionalDependencies.ts';
import { reportStats } from './reportStats.ts';
import { reportSummary, type FilterPkgsDiff } from './reportSummary.ts';
import { reportUpdateCheck } from './reportUpdateCheck.ts';
import type { PeerDependencyRules } from '../../types/index.ts';

const PRINT_EXECUTION_TIME_IN_COMMANDS = {
  install: true,
  update: true,
  add: true,
  remove: true,
};

export function reporterForClient(
  log$: {
    context: Rx.Observable<logs.ContextLog>;
    fetchingProgress: Rx.Observable<logs.FetchingProgressLog>;
    executionTime: Rx.Observable<logs.ExecutionTimeLog>;
    ignoredScripts: Rx.Observable<logs.IgnoredScriptsLog>;
    progress: Rx.Observable<logs.ProgressLog>;
    stage: Rx.Observable<logs.StageLog>;
    deprecation: Rx.Observable<logs.DeprecationLog>;
    summary: Rx.Observable<logs.SummaryLog>;
    lifecycle: Rx.Observable<logs.LifecycleLog>;
    stats: Rx.Observable<logs.StatsLog>;
    installCheck: Rx.Observable<logs.InstallCheckLog>;
    registry: Rx.Observable<logs.RegistryLog>;
    root: Rx.Observable<logs.RootLog>;
    packageManifest: Rx.Observable<logs.PackageManifestLog>;
    peerDependencyIssues: Rx.Observable<logs.PeerDependencyIssuesLog>;
    requestRetry: Rx.Observable<logs.RequestRetryLog>;
    link: Rx.Observable<logs.LinkLog>;
    other: Rx.Observable<logs.Log>;
    hook: Rx.Observable<logs.HookLog>;
    scope: Rx.Observable<logs.ScopeLog>;
    skippedOptionalDependency: Rx.Observable<logs.SkippedOptionalDependencyLog>;
    packageImportMethod: Rx.Observable<logs.PackageImportMethodLog>;
    updateCheck: Rx.Observable<logs.UpdateCheckLog>;
  },
  opts: {
    appendOnly?: boolean | undefined;
    cmd: string;
    config?: Config | undefined;
    env: NodeJS.ProcessEnv;
    filterPkgsDiff?: FilterPkgsDiff | undefined;
    peerDependencyRules?: PeerDependencyRules | undefined;
    process: NodeJS.Process;
    isRecursive: boolean;
    logLevel?: LogLevel | undefined;
    ospmConfig?: Config | undefined;
    streamLifecycleOutput?: boolean | undefined;
    aggregateOutput?: boolean | undefined;
    throttleProgress?: number | undefined;
    width?: number;
    hideAddedPkgsProgress?: boolean | undefined;
    hideProgressPrefix?: boolean | undefined;
    hideLifecycleOutput?: boolean | undefined;
    hideLifecyclePrefix?: boolean | undefined;
  }
): Array<Rx.Observable<Rx.Observable<{ msg: string }>>> {
  const width = (opts.width ?? process.stdout.columns) || 80;
  const cwd = opts.ospmConfig?.dir ?? process.cwd();
  const throttle =
    typeof opts.throttleProgress === 'number' && opts.throttleProgress > 0
      ? throttleTime(opts.throttleProgress, undefined, {
          leading: true,
          trailing: true,
        })
      : undefined;

  const outputs: Array<Rx.Observable<Rx.Observable<{ msg: string }>>> = [
    reportLifecycleScripts(log$, {
      appendOnly:
        (opts.appendOnly === true || opts.streamLifecycleOutput === true) &&
        opts.hideLifecycleOutput !== true,
      aggregateOutput: opts.aggregateOutput ?? false,
      hideLifecyclePrefix: opts.hideLifecyclePrefix ?? false,
      cwd,
      width,
    }),
    reportMisc(log$, {
      appendOnly: opts.appendOnly === true,
      config: opts.config,
      cwd,
      logLevel: opts.logLevel,
      zoomOutCurrent: opts.isRecursive,
      peerDependencyRules: opts.peerDependencyRules,
    }),
    reportInstallChecks(log$.installCheck, { cwd }),
    reportScope(log$.scope, { isRecursive: opts.isRecursive, cmd: opts.cmd }),
    reportSkippedOptionalDependencies(log$.skippedOptionalDependency, { cwd }),
    reportHooks(log$.hook, { cwd, isRecursive: opts.isRecursive }),
    reportUpdateCheck(log$.updateCheck, opts),
  ];

  if (opts.cmd !== 'dlx') {
    outputs.push(reportContext(log$, { cwd }));
  }

  if (opts.cmd in PRINT_EXECUTION_TIME_IN_COMMANDS) {
    outputs.push(reportExecutionTime(log$.executionTime));
  }

  // logLevelNumber: 0123 = error warn info debug
  const logLevelNumber = LOG_LEVEL_NUMBER[opts.logLevel ?? 'info'];

  if (logLevelNumber >= LOG_LEVEL_NUMBER.warn) {
    outputs.push(
      reportPeerDependencyIssues(log$, opts.peerDependencyRules),
      reportDeprecations(
        {
          deprecation: log$.deprecation,
          stage: log$.stage,
        },
        { cwd, isRecursive: opts.isRecursive }
      ),
      reportRequestRetry(log$.requestRetry)
    );
  }

  if (logLevelNumber >= LOG_LEVEL_NUMBER.info) {
    outputs.push(
      reportProgress(log$, {
        cwd,
        throttle,
        hideAddedPkgsProgress: opts.hideAddedPkgsProgress,
        hideProgressPrefix: opts.hideProgressPrefix,
      }),
      ...reportStats(log$, {
        cmd: opts.cmd,
        cwd,
        isRecursive: opts.isRecursive,
        width,
        hideProgressPrefix: opts.hideProgressPrefix,
      })
    );
  }

  if (opts.appendOnly !== true) {
    outputs.push(reportBigTarballProgress(log$));
  }

  if (!opts.isRecursive) {
    outputs.push(
      reportSummary(log$, {
        cmd: opts.cmd,
        cwd,
        env: opts.env,
        filterPkgsDiff: opts.filterPkgsDiff,
        ospmConfig: opts.ospmConfig,
      })
    );
  }

  return outputs;
}
