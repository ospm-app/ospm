import type { Config } from '../packages/config/index.ts';
import { initDefaultReporter } from '../packages/default-reporter/index.ts';
import type { Log } from '../packages/core-loggers/index.ts';
import {
  type LogLevel,
  type StreamParser,
  streamParser,
  writeToConsole,
} from '../packages/logger/index.ts';
import { silentReporter } from './silentReporter.ts';

export type ReporterType = 'default' | 'ndjson' | 'silent' | 'append-only';

export function initReporter(
  reporterType: ReporterType,
  opts: {
    cmd: string | null;
    config: Config;
  }
): void {
  switch (reporterType) {
    case 'default':
      initDefaultReporter({
        useStderr: opts.config.useStderr,
        context: {
          argv: opts.cmd !== null ? [opts.cmd] : [],
          config: opts.config,
        },
        reportingOptions: {
          appendOnly: false,
          logLevel: opts.config.loglevel as LogLevel,
          streamLifecycleOutput: opts.config.stream,
          throttleProgress: 200,
          hideAddedPkgsProgress: opts.config.lockfileOnly,
          hideLifecyclePrefix: opts.config.reporterHidePrefix,
          peerDependencyRules:
            opts.config.rootProjectManifest?.ospm?.peerDependencyRules,
        },
        streamParser: streamParser as StreamParser<Log>,
      });
      return;
    case 'append-only':
      initDefaultReporter({
        useStderr: opts.config.useStderr,
        context: {
          argv: opts.cmd !== null ? [opts.cmd] : [],
          config: opts.config,
        },
        reportingOptions: {
          appendOnly: true,
          aggregateOutput: opts.config.aggregateOutput,
          logLevel: opts.config.loglevel as LogLevel,
          throttleProgress: 1000,
          hideLifecyclePrefix: opts.config.reporterHidePrefix,
          peerDependencyRules:
            opts.config.rootProjectManifest?.ospm?.peerDependencyRules,
        },
        streamParser: streamParser as StreamParser<Log>,
      });
      return;
    case 'ndjson':
      writeToConsole();
      return;
    case 'silent':
      silentReporter(streamParser);
  }
}
