import type { Config } from '../config/index.ts';
import type * as logs from '../core-loggers/index.ts';
import type { LogLevel, StreamParser } from '../logger/index.ts';
import * as Rx from 'rxjs';
import { filter, map, mergeAll } from 'rxjs/operators';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import createDiffer from 'ansi-diff';
import { EOL } from './constants.ts';
import { mergeOutputs } from './mergeOutputs.ts';
import { reporterForClient } from './reporterForClient/index.ts';
import { formatWarn } from './reporterForClient/utils/formatWarn.ts';
import { reporterForServer } from './reporterForServer.ts';
import type { FilterPkgsDiff } from './reporterForClient/reportSummary.ts';
import type { PeerDependencyRules } from '../types/index.ts';
import process from 'node:process';

export { formatWarn };

export function initDefaultReporter(opts: {
  useStderr?: boolean | undefined;
  streamParser: StreamParser<logs.Log>;
  reportingOptions?:
    | {
        appendOnly?: boolean | undefined;
        logLevel?: LogLevel | undefined;
        streamLifecycleOutput?: boolean | undefined;
        aggregateOutput?: boolean | undefined;
        throttleProgress?: number | undefined;
        outputMaxWidth?: number | undefined;
        hideAddedPkgsProgress?: boolean | undefined;
        hideProgressPrefix?: boolean | undefined;
        hideLifecycleOutput?: boolean | undefined;
        hideLifecyclePrefix?: boolean | undefined;
        peerDependencyRules?: PeerDependencyRules | undefined;
      }
    | undefined;
  context: {
    argv: string[];
    config?: Config | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    process?: NodeJS.Process | undefined;
  };
  filterPkgsDiff?: FilterPkgsDiff | undefined;
}): () => void {
  if (opts.context.argv[0] === 'server') {
    // eslint-disable-next-line
    const log$ = Rx.fromEvent<logs.Log>(opts.streamParser as any, 'data');

    const subscription = reporterForServer(log$, opts.context.config);

    return () => {
      subscription.unsubscribe();
    };
  }

  const proc = opts.context.process ?? process;

  const outputMaxWidth =
    opts.reportingOptions?.outputMaxWidth ??
    (proc.stdout.columns ? proc.stdout.columns - 2 : 80);

  const output$ = toOutput$({
    ...opts,
    reportingOptions: {
      ...opts.reportingOptions,
      outputMaxWidth,
    },
  });

  if (opts.reportingOptions?.appendOnly === true) {
    const writeNext =
      opts.useStderr === true
        ? console.error.bind(console)
        : console.info.bind(console);

    const subscription = output$.subscribe({
      complete() {}, // eslint-disable-line:no-empty
      error: (err) => {
        console.error(err.message);
      },
      next: writeNext,
    });

    return () => {
      subscription.unsubscribe();
    };
  }

  const diff = createDiffer({
    height: proc.stdout.rows,
    outputMaxWidth,
  });

  const subscription = output$.subscribe({
    complete() {}, // eslint-disable-line:no-empty
    error: (err) => {
      logUpdate(err.message);
    },
    next: logUpdate,
  });

  const write =
    opts.useStderr === true
      ? proc.stderr.write.bind(proc.stderr)
      : proc.stdout.write.bind(proc.stdout);

  function logUpdate(view: string): void {
    let newView = view;
    // A new line should always be appended in case a prompt needs to appear.
    // Without a new line the prompt will be joined with the previous output.
    // An example of such prompt may be seen by running: ospm update --interactive
    if (!newView.endsWith(EOL)) {
      newView += EOL;
    }

    write(diff.update(view));
  }

  return () => {
    subscription.unsubscribe();
  };
}

export function toOutput$(opts: {
  streamParser: StreamParser<logs.Log>;
  reportingOptions?:
    | {
        appendOnly?: boolean | undefined;
        logLevel?: LogLevel | undefined;
        outputMaxWidth?: number | undefined;
        peerDependencyRules?: PeerDependencyRules | undefined;
        streamLifecycleOutput?: boolean | undefined;
        aggregateOutput?: boolean | undefined;
        throttleProgress?: number | undefined;
        hideAddedPkgsProgress?: boolean | undefined;
        hideProgressPrefix?: boolean | undefined;
        hideLifecycleOutput?: boolean | undefined;
        hideLifecyclePrefix?: boolean | undefined;
      }
    | undefined;
  context: {
    argv: string[];
    config?: Config | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    process?: NodeJS.Process | undefined;
  };
  filterPkgsDiff?: FilterPkgsDiff | undefined;
}): Rx.Observable<string> {
  // opts = opts || {};

  const contextPushStream = new Rx.Subject<logs.ContextLog>();
  const fetchingProgressPushStream = new Rx.Subject<logs.FetchingProgressLog>();
  const executionTimePushStream = new Rx.Subject<logs.ExecutionTimeLog>();
  const progressPushStream = new Rx.Subject<logs.ProgressLog>();
  const stagePushStream = new Rx.Subject<logs.StageLog>();
  const deprecationPushStream = new Rx.Subject<logs.DeprecationLog>();
  const summaryPushStream = new Rx.Subject<logs.SummaryLog>();
  const lifecyclePushStream = new Rx.Subject<logs.LifecycleLog>();
  const statsPushStream = new Rx.Subject<logs.StatsLog>();
  const packageImportMethodPushStream =
    new Rx.Subject<logs.PackageImportMethodLog>();
  const installCheckPushStream = new Rx.Subject<logs.InstallCheckLog>();
  const ignoredScriptsPushStream = new Rx.Subject<logs.IgnoredScriptsLog>();
  const registryPushStream = new Rx.Subject<logs.RegistryLog>();
  const rootPushStream = new Rx.Subject<logs.RootLog>();
  const packageManifestPushStream = new Rx.Subject<logs.PackageManifestLog>();
  const peerDependencyIssuesPushStream =
    new Rx.Subject<logs.PeerDependencyIssuesLog>();
  const linkPushStream = new Rx.Subject<logs.LinkLog>();
  const otherPushStream = new Rx.Subject<logs.Log>();
  const hookPushStream = new Rx.Subject<logs.HookLog>();
  const skippedOptionalDependencyPushStream =
    new Rx.Subject<logs.SkippedOptionalDependencyLog>();
  const scopePushStream = new Rx.Subject<logs.ScopeLog>();
  const requestRetryPushStream = new Rx.Subject<logs.RequestRetryLog>();
  const updateCheckPushStream = new Rx.Subject<logs.UpdateCheckLog>();

  globalThis.setTimeout((): void => {
    opts.streamParser.on('data', (log: logs.Log): void => {
      switch (log.name) {
        case 'ospm:context':
          contextPushStream.next(log);
          break;
        case 'ospm:execution-time':
          executionTimePushStream.next(log);
          break;
        case 'ospm:fetching-progress':
          fetchingProgressPushStream.next(log);
          break;
        case 'ospm:progress':
          progressPushStream.next(log);
          break;
        case 'ospm:stage':
          stagePushStream.next(log);
          break;
        case 'ospm:deprecation':
          deprecationPushStream.next(log);
          break;
        case 'ospm:summary':
          summaryPushStream.next(log);
          break;
        case 'ospm:lifecycle':
          lifecyclePushStream.next(log);
          break;
        case 'ospm:stats':
          statsPushStream.next(log);
          break;
        case 'ospm:package-import-method':
          packageImportMethodPushStream.next(log);
          break;
        case 'ospm:peer-dependency-issues':
          peerDependencyIssuesPushStream.next(log);
          break;
        case 'ospm:install-check':
          installCheckPushStream.next(log);
          break;
        case 'ospm:ignored-scripts':
          ignoredScriptsPushStream.next(log);
          break;
        case 'ospm:registry':
          registryPushStream.next(log);
          break;
        case 'ospm:root':
          rootPushStream.next(log);
          break;
        case 'ospm:package-manifest':
          packageManifestPushStream.next(log);
          break;
        case 'ospm:link':
          linkPushStream.next(log);
          break;
        case 'ospm:hook':
          hookPushStream.next(log);
          break;
        case 'ospm:skipped-optional-dependency':
          skippedOptionalDependencyPushStream.next(log);
          break;
        case 'ospm:scope':
          scopePushStream.next(log);
          break;
        case 'ospm:request-retry':
          requestRetryPushStream.next(log);
          break;
        case 'ospm:update-check':
          updateCheckPushStream.next(log);
          break;
        case 'ospm' as any: // eslint-disable-line
        case 'ospm:global' as any: // eslint-disable-line
        case 'ospm:store' as any: // eslint-disable-line
        case 'ospm:lockfile' as any: // eslint-disable-line
          otherPushStream.next(log);
          break;
      }
    });
  }, 0);
  let other = Rx.from(otherPushStream);
  if (opts.context.config?.hooks?.filterLog != null) {
    const filterLogs = opts.context.config.hooks.filterLog;
    const filterFn =
      filterLogs.length === 1
        ? filterLogs[0]
        : (log: logs.Log) => filterLogs.every((filterLog) => filterLog(log));

    if (typeof filterFn === 'function') {
      other = other.pipe(filter(filterFn));
    }
  }

  const log$ = {
    context: Rx.from(contextPushStream),
    deprecation: Rx.from(deprecationPushStream),
    fetchingProgress: Rx.from(fetchingProgressPushStream),
    executionTime: Rx.from(executionTimePushStream),
    hook: Rx.from(hookPushStream),
    installCheck: Rx.from(installCheckPushStream),
    ignoredScripts: Rx.from(ignoredScriptsPushStream),
    lifecycle: Rx.from(lifecyclePushStream),
    link: Rx.from(linkPushStream),
    other,
    packageImportMethod: Rx.from(packageImportMethodPushStream),
    packageManifest: Rx.from(packageManifestPushStream),
    peerDependencyIssues: Rx.from(peerDependencyIssuesPushStream),
    progress: Rx.from(progressPushStream),
    registry: Rx.from(registryPushStream),
    requestRetry: Rx.from(requestRetryPushStream),
    root: Rx.from(rootPushStream),
    scope: Rx.from(scopePushStream),
    skippedOptionalDependency: Rx.from(skippedOptionalDependencyPushStream),
    stage: Rx.from(stagePushStream),
    stats: Rx.from(statsPushStream),
    summary: Rx.from(summaryPushStream),
    updateCheck: Rx.from(updateCheckPushStream),
  };

  const cmd = opts.context.argv[0];

  if (typeof cmd !== 'string') {
    throw new Error('cmd is required');
  }

  const outputs: Array<Rx.Observable<Rx.Observable<{ msg: string }>>> =
    reporterForClient(log$, {
      appendOnly: opts.reportingOptions?.appendOnly,
      cmd,
      config: opts.context.config,
      env: opts.context.env ?? process.env,
      filterPkgsDiff: opts.filterPkgsDiff,
      peerDependencyRules: opts.reportingOptions?.peerDependencyRules,
      process: opts.context.process ?? process,
      isRecursive: opts.context.config?.['recursive'] === true,
      logLevel: opts.reportingOptions?.logLevel,
      ospmConfig: opts.context.config,
      streamLifecycleOutput: opts.reportingOptions?.streamLifecycleOutput,
      aggregateOutput: opts.reportingOptions?.aggregateOutput,
      throttleProgress: opts.reportingOptions?.throttleProgress,
      width: opts.reportingOptions?.outputMaxWidth ?? 80,
      hideAddedPkgsProgress: opts.reportingOptions?.hideAddedPkgsProgress,
      hideProgressPrefix:
        opts.reportingOptions?.hideProgressPrefix ?? cmd === 'dlx',
      hideLifecycleOutput: opts.reportingOptions?.hideLifecycleOutput,
      hideLifecyclePrefix: opts.reportingOptions?.hideLifecyclePrefix,
    });

  if (opts.reportingOptions?.appendOnly === true) {
    return Rx.merge(...outputs).pipe(
      map((log: Rx.Observable<{ msg: string }>) =>
        log.pipe(map((msg) => msg.msg))
      ),
      mergeAll()
    );
  }

  return mergeOutputs(outputs);
}
