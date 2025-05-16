export const REPORTER_INITIALIZED = Symbol('reporterInitialized');

export type Global = typeof globalThis & {
  ospm__startedAt?: number;
  [REPORTER_INITIALIZED]?: ReporterType;
};
declare const global: Global;

if (typeof global['ospm__startedAt'] === 'undefined') {
  global['ospm__startedAt'] = Date.now();
}

import process from 'node:process';
import loudRejection from 'loud-rejection';
import {
  packageManager,
  isExecutedByCorepack,
} from './packages/cli-meta/index.ts';
import { getConfig } from './packages/cli-utils/index.ts';
import type { Config, WantedPackageManager } from './packages/config/index.ts';
import {
  executionTimeLogger,
  scopeLogger,
} from './packages/core-loggers/index.ts';
import { OspmError } from './packages/error/index.ts';
import { filterPackagesFromDir } from './packages/filter-workspace-packages/index.ts';
import { globalWarn, logger } from './packages/logger/index.ts';
import type { ParsedCliArgs } from './packages/parse-cli-args/index.ts';
import { prepareExecutionEnv } from './packages/plugin-commands-env/index.ts';
import { finishWorkers } from './packages/worker/index.ts';
import chalk from 'chalk';
import { isCI } from 'ci-info';
import path from 'node:path';
import isEmpty from 'ramda/src/isEmpty';
import { stripVTControlCharacters as stripAnsi } from 'node:util';
import { checkForUpdates } from './checkForUpdates.ts';
import {
  ospmCmds,
  rcOptionsTypes,
  skipPackageManagerCheckForCommand,
} from './cmd/index.ts';
import { formatUnknownOptionsError } from './formatError.ts';
import { parseCliArgs } from './parseCliArgs.ts';
import { initReporter, type ReporterType } from './reporter/index.ts';
import { switchCliVersion } from './switchCliVersion.ts';
import type { WorkspaceDir } from './packages/types/project.ts';

loudRejection();

const DEPRECATED_OPTIONS = new Set([
  'independent-leaves',
  'lock',
  'resolution-strategy',
]);

// A workaround for the https://github.com/vercel/pkg/issues/897 issue.
// biome-ignore lint/performance/noDelete: <explanation>
delete process.env.PKG_EXECPATH;

export async function main(inputArgv: string[]): Promise<void> {
  let parsedCliArgs: ParsedCliArgs;

  try {
    parsedCliArgs = await parseCliArgs(inputArgv);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Reporting is not initialized at this point, so just printing the error
    printError(err.message, err['hint']);
    process.exitCode = 1;
    return;
  }

  const {
    argv,
    params: cliParams,
    options: cliOptions,
    cmd,
    fallbackCommandUsed,
    unknownOptions,
    workspaceDir,
  } = parsedCliArgs;

  if (cmd !== null && !ospmCmds[cmd]) {
    printError(`Unknown command '${cmd}'`, 'For help, run: ospm help');

    process.exitCode = 1;

    return;
  }

  if (unknownOptions.size > 0 && !fallbackCommandUsed) {
    const unknownOptionsArray = Array.from(unknownOptions.keys());

    if (unknownOptionsArray.every((option) => DEPRECATED_OPTIONS.has(option))) {
      let deprecationMsg = `${chalk.bgYellow.black('\u2009WARN\u2009')}`;

      if (unknownOptionsArray.length === 1) {
        const deprecatedOption = unknownOptionsArray[0];

        if (typeof deprecatedOption === 'string') {
          deprecationMsg += ` ${chalk.yellow(`Deprecated option: '${deprecatedOption}'`)}`;
        }
      } else {
        deprecationMsg += ` ${chalk.yellow(
          `Deprecated options: ${unknownOptionsArray
            .map((unknownOption: string): string => {
              return `'${unknownOption}'`;
            })
            .join(', ')}`
        )}`;
      }

      console.info(deprecationMsg);
    } else {
      printError(
        formatUnknownOptionsError(unknownOptions),
        `For help, run: ospm help${typeof cmd === 'string' ? ` ${cmd}` : ''}`
      );

      process.exitCode = 1;

      return;
    }
  }

  let config: Config & {
    argv?:
      | { remain: string[]; cooked: string[]; original: string[] }
      | undefined;
    fallbackCommandUsed?: boolean | undefined;
    parseable?: boolean | undefined;
    json?: boolean | undefined;
  };

  try {
    // When we just want to print the location of the global bin directory,
    // we don't need the write permission to it. Related issue: #2700
    const globalDirShouldAllowWrite = cmd !== 'root';

    const isDlxCommand = cmd === 'dlx';

    if (cmd === 'link' && cliParams.length === 0) {
      cliOptions.global = true;
    }

    config = await getConfig(cliOptions, {
      excludeReporter: false,
      globalDirShouldAllowWrite,
      rcOptionsTypes,
      workspaceDir,
      checkUnknownSetting: false,
      ignoreNonAuthSettingsFromLocal: isDlxCommand || cmd === 'self-update',
    });

    if (
      !isExecutedByCorepack() &&
      cmd !== 'setup' &&
      config.wantedPackageManager != null
    ) {
      if (
        typeof config.managePackageManagerVersions !== 'undefined' &&
        config.wantedPackageManager.name === 'ospm'
      ) {
        await switchCliVersion(config);
      } else if (cmd === null || !skipPackageManagerCheckForCommand.has(cmd)) {
        checkPackageManager(config.wantedPackageManager, config);
      }
    }

    if (isDlxCommand) {
      config.useStderr = true;
    }

    config.argv = argv;

    config.fallbackCommandUsed = fallbackCommandUsed;

    // Set 'npm_command' env variable to current command name
    if (typeof cmd === 'string') {
      config.extraEnv = {
        ...config.extraEnv,
        // Follow the behavior of npm by setting it to 'run-script' when running scripts (e.g. ospm run dev)
        // and to the command name otherwise (e.g. ospm test)
        npm_command: cmd === 'run' ? 'run-script' : cmd,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Reporting is not initialized at this point, so just printing the error
    const hint =
      typeof err['hint'] === 'string'
        ? err['hint']
        : `For help, run: ospm help${typeof cmd === 'string' ? ` ${cmd}` : ''}`;

    printError(err.message, hint);

    process.exitCode = 1;

    return;
  }

  if (cmd == null && cliOptions.version === true) {
    console.info(packageManager.version);

    return;
  }

  let write: (text: string) => void = process.stdout.write.bind(process.stdout);

  // chalk reads the FORCE_COLOR env variable
  if (config.color === 'always') {
    process.env.FORCE_COLOR = '1';
  } else if (config.color === 'never') {
    process.env.FORCE_COLOR = '0';

    // In some cases, it is already late to set the FORCE_COLOR env variable.
    // Some text might be already generated.
    //
    // A better solution might be to dynamically load all the code after the settings are read
    // and the env variable set.
    write = (text): boolean => {
      return process.stdout.write(stripAnsi(text));
    };
  }

  const reporterType: ReporterType = ((): ReporterType => {
    if (config.loglevel === 'silent') {
      return 'silent';
    }

    if (typeof config.reporter === 'string') {
      return config.reporter;
    }

    if (isCI || !process.stdout.isTTY) {
      return 'append-only';
    }

    return 'default';
  })();

  const printLogs = config['parseable'] !== true && config['json'] !== true;

  if (printLogs) {
    initReporter(reporterType, {
      cmd,
      config,
    });

    global[REPORTER_INITIALIZED] = reporterType;
  }

  if (cmd === 'self-update') {
    await ospmCmds.server?.(config, ['stop']);
  }

  if (
    [
      'install',
      'import',
      'dedupe',
      'patch-commit',
      'patch',
      'patch-remove',
      'approve-builds',
    ].includes(cmd === null ? '' : cmd) &&
    typeof workspaceDir === 'string'
  ) {
    cliOptions.recursive = true;

    config.recursive = true;

    if (
      config.recursiveInstall !== true &&
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      !config.filter &&
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      !config.filterProd
    ) {
      config.filter = ['{.}...'];
    }
  }

  if (cliOptions.recursive === true) {
    const wsDir: WorkspaceDir = workspaceDir ?? (process.cwd() as WorkspaceDir);

    config.filter = Array.isArray(config.filter)
      ? config.filter
      : typeof config.filter === 'string'
        ? [config.filter]
        : [];

    config.filterProd = Array.isArray(config.filterProd)
      ? config.filterProd
      : typeof config.filterProd === 'string'
        ? [config.filterProd]
        : [];

    const filters = [
      ...config.filter.map(
        (filter: string): { filter: string; followProdDepsOnly: boolean } => {
          return { filter, followProdDepsOnly: false };
        }
      ),
      ...config.filterProd.map(
        (filter: string): { filter: string; followProdDepsOnly: boolean } => {
          return {
            filter,
            followProdDepsOnly: true,
          };
        }
      ),
    ];

    function relativeWSDirPath(): string {
      return path.relative(process.cwd(), wsDir) || '.';
    }

    if (config.workspaceRoot === true) {
      filters.push({
        filter: `{${relativeWSDirPath()}}`,
        followProdDepsOnly: Boolean(config.filterProd.length),
      });
    } else if (
      typeof workspaceDir === 'string' &&
      config.includeWorkspaceRoot !== true &&
      ['run', 'exec', 'add', 'test'].includes(cmd ?? '')
    ) {
      filters.push({
        filter: `!{${relativeWSDirPath()}}`,
        followProdDepsOnly: Boolean(config.filterProd.length),
      });
    }

    const filterResults = await filterPackagesFromDir(wsDir, filters, {
      engineStrict: config.engineStrict,
      nodeVersion: config.nodeVersion ?? config.useNodeVersion,
      patterns: config.workspacePackagePatterns,
      linkWorkspacePackages:
        typeof config.linkWorkspacePackages === 'string'
          ? false
          : config.linkWorkspacePackages,
      prefix: process.cwd(),
      workspaceDir: wsDir,
      testPattern: config.testPattern,
      changedFilesIgnorePattern: config.changedFilesIgnorePattern,
      useGlobDirFiltering: config.legacyDirFiltering !== true,
      sharedWorkspaceLockfile: config.sharedWorkspaceLockfile,
    });

    if (filterResults.allProjects.length === 0) {
      if (printLogs) {
        console.info(`No projects found in "${wsDir}"`);
      }

      process.exitCode = config.failIfNoMatch ? 1 : 0;

      return;
    }

    config.allProjectsGraph = filterResults.allProjectsGraph;

    config.selectedProjectsGraph = filterResults.selectedProjectsGraph;

    if (isEmpty.default(config.selectedProjectsGraph)) {
      if (printLogs) {
        console.info(`No projects matched the filters in "${wsDir}"`);
      }

      process.exitCode = config.failIfNoMatch ? 1 : 0;

      return;
    }

    if (filterResults.unmatchedFilters.length !== 0 && printLogs) {
      console.info(
        `No projects matched the filters "${filterResults.unmatchedFilters.join(', ')}" in "${wsDir}"`
      );
    }

    config.allProjects = filterResults.allProjects;

    config.workspaceDir = wsDir;
  }

  let { output, exitCode }: { output?: string | null; exitCode: number } =
    await (async (): Promise<
      { output?: string; exitCode: number } | { output: null; exitCode: number }
    > => {
      // NOTE: we defer the next stage, otherwise reporter might not catch all the logs
      await new Promise<void>((resolve): NodeJS.Timeout => {
        return globalThis.setTimeout((): void => {
          resolve();
        }, 0);
      });

      if (
        config.updateNotifier !== false &&
        !isCI &&
        cmd !== 'self-update' &&
        config.offline !== true &&
        config.preferOffline !== true &&
        config.fallbackCommandUsed !== true &&
        (cmd === 'install' || cmd === 'add')
      ) {
        checkForUpdates(config).catch(() => {
          /* Ignore */
        });
      }

      if (config.force === true && config.fallbackCommandUsed !== true) {
        logger.warn({
          message: 'using --force I sure hope you know what you are doing',
          prefix: config.dir,
        });
      }

      scopeLogger.debug({
        ...(cliOptions.recursive === true
          ? {
              selected: Object.keys(config.selectedProjectsGraph ?? {}).length,
              total: config.allProjects?.length,
            }
          : { selected: 1 }),
        ...(typeof workspaceDir === 'string'
          ? { workspacePrefix: workspaceDir }
          : {}),
      });

      if (config.useNodeVersion != null) {
        if ('webcontainer' in process.versions) {
          globalWarn(
            'Automatic installation of different Node.js versions is not supported in WebContainer'
          );
        } else {
          config.extraBinPaths = (
            await prepareExecutionEnv(config, {
              extraBinPaths: config.extraBinPaths,
              executionEnv: {
                nodeVersion: config.useNodeVersion,
              },
            })
          ).extraBinPaths;

          config.nodeVersion = config.useNodeVersion;
        }
      }

      let result = ospmCmds[cmd ?? 'help']?.(
        // TypeScript doesn't currently infer that the type of config
        // is `Omit<typeof config, 'reporter'>` after the `delete config.reporter` statement
        config,
        cliParams
      );

      if (result instanceof Promise) {
        result = await result;
      }

      executionTimeLogger.debug({
        startedAt: global['ospm__startedAt'],
        endedAt: Date.now(),
      });

      if (typeof result === 'undefined') {
        return { output: null, exitCode: 0 };
      }

      if (typeof result === 'string') {
        return { output: result, exitCode: 0 };
      }

      return result;
    })();

  // When use-node-version is set and "ospm run" is executed,
  // this will be the only place where the tarball worker pool is finished.
  await finishWorkers();

  if (typeof output === 'string') {
    if (!output.endsWith('\n')) {
      output = `${output}\n`;
    }

    write(output);
  }

  if (cmd === null) {
    exitCode = 1;
  }

  if (exitCode) {
    process.exitCode = exitCode;
  }
}

function printError(message: string, hint?: string): void {
  const ERROR = chalk.bgRed.black('\u2009ERROR\u2009');

  console.error(
    `${message.startsWith(ERROR) ? '' : `${ERROR} `}${chalk.red(message)}`
  );

  if (typeof hint === 'string') {
    console.error(hint);
  }
}

function checkPackageManager(pm: WantedPackageManager, config: Config): void {
  if (!pm.name) return;

  if (pm.name === 'ospm') {
    const currentOspmVersion =
      packageManager.name === 'ospm' ? packageManager.version : undefined;

    if (
      typeof currentOspmVersion === 'string' &&
      config.packageManagerStrictVersion === true &&
      typeof pm.version === 'string' &&
      pm.version !== currentOspmVersion
    ) {
      const msg = `This project is configured to use v${pm.version} of ospm. Your current ospm is v${currentOspmVersion}`;

      if (config.packageManagerStrict === true) {
        throw new OspmError('BAD_PM_VERSION', msg, {
          hint: 'If you want to bypass this version check, you can set the "package-manager-strict" configuration to "false" or set the "COREPACK_ENABLE_STRICT" environment variable to "0"',
        });
      }

      globalWarn(msg);
    }
    return;
  }

  const msg = `This project is configured to use ${pm.name}`;

  if (config.packageManagerStrict === true) {
    throw new OspmError('OTHER_PM_EXPECTED', msg);
  }

  globalWarn(msg);
}
