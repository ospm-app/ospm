import assert from 'node:assert';
import path from 'node:path';
import util from 'node:util';
import {
  throwOnCommandFail,
  type RecursiveSummary,
} from '../cli-utils/index.ts';
import type { Config } from '../config/index.ts';
import { prepareExecutionEnv } from '../plugin-commands-env/index.ts';
import { PnpmError } from '../error/index.ts';
import {
  makeNodeRequireOption,
  type RunLifecycleHookOptions,
} from '../lifecycle/index.ts';
import { logger } from '../logger/index.ts';
import { groupStart } from '@pnpm/log.group';
import { sortPackages } from '../sort-packages/index.ts';
import pLimit from 'p-limit';
import realpathMissing from 'realpath-missing';
import { existsInDir } from './existsInDir.ts';
import {
  createEmptyRecursiveSummary,
  getExecutionDuration,
  getResumedPackageChunks,
  writeRecursiveSummary,
} from './exec.ts';
import { type RunScriptOptions, runScript } from './run.ts';
import { tryBuildRegExpFromCommand } from './regexpCommand.ts';
import type {
  PackageScripts,
  Project,
  ProjectRootDir,
} from '../types/index.ts';
import process from 'node:process';

export type RecursiveRunOpts = Pick<
  Config,
  | 'bin'
  | 'enablePrePostScripts'
  | 'unsafePerm'
  | 'pnpmHomeDir'
  | 'rawConfig'
  | 'rootProjectManifest'
  | 'scriptsPrependNodePath'
  | 'scriptShell'
  | 'shellEmulator'
  | 'stream'
  | 'syncInjectedDepsAfterScripts'
  | 'workspaceDir'
  | 'storeDir'
> &
  Required<
    Pick<
      Config,
      'allProjects' | 'selectedProjectsGraph' | 'workspaceDir' | 'dir'
    >
  > &
  Partial<
    Pick<
      Config,
      | 'extraBinPaths'
      | 'extraEnv'
      | 'bail'
      | 'reporter'
      | 'reverse'
      | 'sort'
      | 'workspaceConcurrency'
    >
  > & {
    ifPresent?: boolean | undefined;
    resumeFrom?: string | undefined;
    reportSummary?: boolean | undefined;
  };

export async function runRecursive(
  params: string[],
  opts: RecursiveRunOpts
): Promise<void> {
  const [scriptName, ...passedThruArgs] = params;

  if (typeof scriptName === 'undefined') {
    throw new PnpmError(
      'SCRIPT_NAME_IS_REQUIRED',
      'You must specify the script you want to run'
    );
  }

  let hasCommand = 0;

  const sortedPackageChunks =
    opts.sort === true
      ? sortPackages(opts.selectedProjectsGraph ?? {})
      : [Object.keys(opts.selectedProjectsGraph ?? {}).sort()];

  let packageChunks: ProjectRootDir[][] =
    opts.reverse === true
      ? (sortedPackageChunks.reverse() as ProjectRootDir[][])
      : (sortedPackageChunks as ProjectRootDir[][]);

  if (typeof opts.resumeFrom === 'string') {
    packageChunks = getResumedPackageChunks({
      resumeFrom: opts.resumeFrom,
      chunks: packageChunks,
      selectedProjectsGraph: opts.selectedProjectsGraph ?? {},
    });
  }

  const limitRun = pLimit(opts.workspaceConcurrency ?? 4);

  const stdio =
    opts.stream !== true &&
    (opts.workspaceConcurrency === 1 ||
      (packageChunks.length === 1 && packageChunks[0]?.length === 1))
      ? 'inherit'
      : 'pipe';

  const existsPnp = existsInDir.bind(null, '.pnp.cjs');

  const workspacePnpPath =
    typeof opts.workspaceDir === 'string' && existsPnp(opts.workspaceDir);

  const requiredScripts = opts.rootProjectManifest?.pnpm?.requiredScripts ?? [];

  if (requiredScripts.includes(scriptName)) {
    const missingScriptPackages: string[] = packageChunks
      .flat()
      .map(
        (
          prefix: ProjectRootDir
        ):
          | {
              dependencies: ProjectRootDir[];
              package: Project;
            }
          | undefined => {
          return opts.selectedProjectsGraph?.[prefix];
        }
      )
      .filter(Boolean)
      .filter(
        (pkg: {
          dependencies: ProjectRootDir[];
          package: Project;
        }): boolean => {
          return (
            getSpecifiedScripts(pkg.package.manifest.scripts ?? {}, scriptName)
              .length < 1
          );
        }
      )
      .map(
        (pkg: {
          dependencies: ProjectRootDir[];
          package: Project;
        }): string => {
          return pkg.package.manifest.name || pkg.package.rootDir;
        }
      );
    if (missingScriptPackages.length) {
      throw new PnpmError(
        'RECURSIVE_RUN_NO_SCRIPT',
        `Missing script "${scriptName}" in packages: ${missingScriptPackages.join(', ')}`
      );
    }
  }

  const result: RecursiveSummary = createEmptyRecursiveSummary(packageChunks);

  for (const chunk of packageChunks) {
    const selectedScripts = chunk.flatMap(
      (
        prefix: ProjectRootDir
      ): {
        prefix: ProjectRootDir;
        scriptName: string;
      }[] => {
        const pkg = opts.selectedProjectsGraph?.[prefix];

        if (typeof pkg === 'undefined') {
          return [];
        }

        const specifiedScripts = getSpecifiedScripts(
          pkg.package.manifest.scripts ?? {},
          scriptName
        );

        if (
          specifiedScripts.length === 0 &&
          typeof result[prefix] !== 'undefined'
        ) {
          result[prefix].status = 'skipped';
        }

        return specifiedScripts.map(
          (
            script: string
          ): {
            prefix: ProjectRootDir;
            scriptName: string;
          } => {
            return { prefix, scriptName: script };
          }
        );
      }
    );

    await Promise.all(
      selectedScripts.map(
        async ({
          prefix,
          scriptName,
        }: {
          prefix: ProjectRootDir;
          scriptName: string;
        }): Promise<void> => {
          return limitRun(async (): Promise<void> => {
            const pkg = opts.selectedProjectsGraph?.[prefix];

            if (typeof pkg === 'undefined') {
              return;
            }

            if (
              typeof pkg.package.manifest.scripts?.[scriptName] ===
                'undefined' ||
              (process.env.npm_lifecycle_event === scriptName &&
                process.env.PNPM_SCRIPT_SRC_DIR === prefix)
            ) {
              return;
            }

            if (typeof result[prefix] !== 'undefined') {
              result[prefix].status = 'running';
            }

            const startTime = process.hrtime();

            hasCommand++;

            try {
              const lifecycleOpts: RunLifecycleHookOptions = {
                depPath: prefix,
                extraBinPaths: opts.extraBinPaths,
                extraEnv: opts.extraEnv,
                pkgRoot: prefix,
                rawConfig: opts.rawConfig,
                rootModulesDir: await realpathMissing(
                  path.join(prefix, 'node_modules')
                ),
                scriptsPrependNodePath: opts.scriptsPrependNodePath,
                scriptShell: opts.scriptShell,
                silent: opts.reporter === 'silent',
                shellEmulator: opts.shellEmulator,
                stdio,
                unsafePerm: true, // when running scripts explicitly, assume that they're trusted.
              };

              const { executionEnv } = pkg.package.manifest.pnpm ?? {};

              if (executionEnv != null) {
                lifecycleOpts.extraBinPaths = (
                  await prepareExecutionEnv(opts, { executionEnv })
                ).extraBinPaths;
              }

              const pnpPath = workspacePnpPath ?? existsPnp(prefix);

              if (typeof pnpPath === 'string') {
                lifecycleOpts.extraEnv = {
                  ...lifecycleOpts.extraEnv,
                  ...makeNodeRequireOption(pnpPath),
                };
              }

              const runScriptOptions: RunScriptOptions = {
                enablePrePostScripts: opts.enablePrePostScripts ?? false,
                syncInjectedDepsAfterScripts: opts.syncInjectedDepsAfterScripts,
                workspaceDir: opts.workspaceDir,
              };

              const _runScript = runScript.bind(null, {
                manifest: pkg.package.manifest,
                lifecycleOpts,
                runScriptOptions,
                passedThruArgs,
              });

              const groupEnd =
                (opts.workspaceConcurrency ?? 4) > 1
                  ? undefined
                  : groupStart(
                      formatSectionName({
                        name: pkg.package.manifest.name,
                        script: scriptName,
                        version: pkg.package.manifest.version,
                        prefix: path.normalize(
                          path.relative(
                            opts.workspaceDir ?? process.cwd(),
                            prefix
                          )
                        ),
                      })
                    );

              await _runScript(scriptName);

              groupEnd?.();

              if (typeof result[prefix] !== 'undefined') {
                result[prefix].status = 'passed';

                result[prefix].duration = getExecutionDuration(startTime);
              }
            } catch (err: unknown) {
              assert(util.types.isNativeError(err));

              result[prefix] = {
                status: 'failure',
                duration: getExecutionDuration(startTime),
                error: err,
                message: err.message,
                prefix,
              };

              if (opts.bail !== true) {
                return;
              }

              Object.assign(err, {
                code: 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL',
                prefix,
              });

              if (opts.reportSummary === true) {
                await writeRecursiveSummary({
                  dir: opts.workspaceDir ?? opts.dir,
                  summary: result,
                });
              }

              throw err;
            }
          });
        }
      )
    );
  }

  if (scriptName !== 'test' && !hasCommand && opts.ifPresent !== true) {
    const allPackagesAreSelected =
      Object.keys(opts.selectedProjectsGraph ?? {}).length ===
      opts.allProjects?.length;

    if (allPackagesAreSelected) {
      throw new PnpmError(
        'RECURSIVE_RUN_NO_SCRIPT',
        `None of the packages has a "${scriptName}" script`
      );
    }

    logger.info({
      message: `None of the selected packages has a "${scriptName}" script`,
      prefix: opts.workspaceDir,
    });
  }

  if (opts.reportSummary === true) {
    await writeRecursiveSummary({
      dir: opts.workspaceDir ?? opts.dir,
      summary: result,
    });
  }

  throwOnCommandFail('pnpm recursive run', result);
}

function formatSectionName({
  script,
  name,
  version,
  prefix,
}: {
  script?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  prefix: string;
}): string {
  return `${name ?? 'unknown'}${typeof version === 'string' ? `@${version}` : ''} ${typeof script === 'string' ? `: ${script}` : ''} ${prefix}`;
}

export function getSpecifiedScripts(
  scripts: PackageScripts,
  scriptName: string
): string[] {
  // if scripts in package.json has script which is equal to scriptName a user passes, return it.
  if (typeof scripts[scriptName] !== 'undefined') {
    return [scriptName];
  }

  const scriptSelector = tryBuildRegExpFromCommand(scriptName);

  // if scriptName which a user passes is RegExp (like /build:.*/), multiple scripts to execute will be selected with RegExp
  if (scriptSelector) {
    const scriptKeys = Object.keys(scripts);
    return scriptKeys.filter((script) => script.match(scriptSelector));
  }

  return [];
}
