import path from 'node:path';
import {
  docsUrl,
  type RecursiveSummary,
  throwOnCommandFail,
  readProjectManifestOnly,
} from '../cli-utils/index.ts';
import {
  type LifecycleMessage,
  lifecycleLogger,
} from '../core-loggers/index.ts';
import {
  FILTERING,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { type Config, types } from '../config/index.ts';
import type { CheckDepsStatusOptions } from '../deps.status/index.ts';
import { makeNodeRequireOption } from '../lifecycle/index.ts';
import { logger } from '../logger/index.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import { prepareExecutionEnv } from '../plugin-commands-env/index.ts';
import { sortPackages } from '../sort-packages/index.ts';
import type {
  Project,
  ProjectsGraph,
  ProjectRootDir,
  ProjectRootDirRealPath,
} from '../types/index.ts';
import { execa } from 'execa';
import pLimit from 'p-limit';
import { prependDirsToPath } from '../env.path/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { existsInDir } from './existsInDir.ts';
import { makeEnv } from './makeEnv.ts';
import {
  PARALLEL_OPTION_HELP,
  REPORT_SUMMARY_OPTION_HELP,
  RESUME_FROM_OPTION_HELP,
  shorthands as runShorthands,
} from './run.ts';
import { PnpmError } from '../error/index.ts';
import which from 'which';
import { writeJsonFile } from 'write-json-file';
import {
  getNearestProgram,
  getNearestScript,
} from './buildCommandNotFoundHint.ts';
import { runDepsStatusCheck } from './runDepsStatusCheck.ts';

export const shorthands: Record<string, string | string[]> = {
  parallel: runShorthands.parallel ?? [],
  c: '--shell-mode',
};

export const commandNames = ['exec'];

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(
      [
        'bail',
        'sort',
        'use-node-version',
        'unsafe-perm',
        'workspace-concurrency',
        'reporter-hide-prefix',
      ],
      types
    ),
    'shell-mode': Boolean,
    'resume-from': String,
    'report-summary': Boolean,
  };
}

export const cliOptionsTypes = (): Record<string, unknown> => ({
  ...rcOptionsTypes(),
  recursive: Boolean,
  reverse: Boolean,
});

export function help(): string {
  return renderHelp({
    description: 'Run a shell command in the context of a project.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Do not hide project name prefix from output of recursively running command.',
            name: '--no-reporter-hide-prefix',
          },
          PARALLEL_OPTION_HELP,
          {
            description:
              'Run the shell command in every package found in subdirectories \
or every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "pnpm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description:
              'If exist, runs file inside of a shell. \
Uses /bin/sh on UNIX and \\cmd.exe on Windows. \
The shell should understand the -c switch on UNIX or /d /s /c on Windows.',
            name: '--shell-mode',
            shortAlias: '-c',
          },
          RESUME_FROM_OPTION_HELP,
          REPORT_SUMMARY_OPTION_HELP,
          ...UNIVERSAL_OPTIONS,
        ],
      },
      FILTERING,
    ],
    url: docsUrl('exec'),
    usages: ['pnpm [-r] [-c] exec <command> [args...]'],
  });
}

export function getResumedPackageChunks({
  resumeFrom,
  chunks,
  selectedProjectsGraph,
}: {
  resumeFrom: string;
  chunks: ProjectRootDir[][];
  selectedProjectsGraph: ProjectsGraph;
}): ProjectRootDir[][] {
  const resumeFromPackagePrefix = (
    Object.keys(selectedProjectsGraph) as ProjectRootDir[]
  ).find(
    (prefix) =>
      selectedProjectsGraph[prefix]?.package.manifest.name === resumeFrom
  );

  if (!resumeFromPackagePrefix) {
    throw new PnpmError(
      'RESUME_FROM_NOT_FOUND',
      `Cannot find package ${resumeFrom}. Could not determine where to resume from.`
    );
  }

  const chunkPosition = chunks.findIndex((chunk) =>
    chunk.includes(resumeFromPackagePrefix)
  );
  return chunks.slice(chunkPosition);
}

export async function writeRecursiveSummary(opts: {
  dir: string;
  summary: RecursiveSummary;
}): Promise<void> {
  await writeJsonFile(path.join(opts.dir, 'pnpm-exec-summary.json'), {
    executionStatus: opts.summary,
  });
}

export function createEmptyRecursiveSummary(
  chunks: string[][]
): RecursiveSummary {
  const acc: RecursiveSummary = {};
  for (const prefix of chunks.flat()) {
    acc[prefix] = { status: 'queued' };
  }
  return acc;
}

export function getExecutionDuration(start: [number, number]): number {
  const end = process.hrtime(start);
  return (end[0] * 1e9 + end[1]) / 1e6;
}

export type ExecOpts = Required<
  Pick<Config, 'selectedProjectsGraph' | 'storeDir'>
> & {
  bail?: boolean | undefined;
  unsafePerm?: boolean | undefined;
  reverse?: boolean | undefined;
  sort?: boolean | undefined;
  workspaceConcurrency?: number | undefined;
  shellMode?: boolean | undefined;
  resumeFrom?: string | undefined;
  reportSummary?: boolean | undefined;
  implicitlyFellbackFromRun?: boolean | undefined;
} & Pick<
    Config,
    | 'bin'
    | 'dir'
    | 'extraBinPaths'
    | 'extraEnv'
    | 'lockfileDir'
    | 'modulesDir'
    | 'nodeOptions'
    | 'pnpmHomeDir'
    | 'rawConfig'
    | 'recursive'
    | 'reporterHidePrefix'
    | 'userAgent'
    | 'verifyDepsBeforeRun'
    | 'workspaceDir'
  > &
  CheckDepsStatusOptions;

export async function handler(
  opts: ExecOpts,
  params: string[]
): Promise<{ exitCode: number }> {
  const firstParam = params[0];
  // For backward compatibility
  if (firstParam === '--') {
    params.shift();
  }

  if (typeof firstParam === 'undefined') {
    throw new PnpmError(
      'EXEC_MISSING_COMMAND',
      "'pnpm exec' requires a command to run"
    );
  }

  const limitRun = pLimit(opts.workspaceConcurrency ?? 4);

  if (typeof opts.verifyDepsBeforeRun !== 'undefined') {
    await runDepsStatusCheck(opts);
  }

  if (typeof opts.selectedProjectsGraph === 'undefined') {
    throw new PnpmError(
      'RECURSIVE_EXEC_NO_PACKAGE',
      'No package found in this workspace'
    );
  }

  let chunks: ProjectRootDir[][] | undefined;

  if (opts.recursive === true) {
    chunks =
      opts.sort === true
        ? sortPackages(opts.selectedProjectsGraph)
        : [
            (
              Object.keys(opts.selectedProjectsGraph) as ProjectRootDir[]
            ).sort(),
          ];

    if (opts.reverse === true) {
      chunks = chunks.reverse();
    }
  } else {
    chunks = [[opts.dir as unknown as ProjectRootDir]];

    const project = await tryReadProjectManifest(opts.dir);

    if (project.manifest !== null) {
      opts.selectedProjectsGraph = {
        [opts.dir]: {
          dependencies: [],
          package: {
            ...project,
            rootDir: opts.dir as unknown as ProjectRootDir,
            rootDirRealPath: opts.dir as ProjectRootDirRealPath,
          } as Project,
        },
      };
    }
  }

  if (typeof opts.selectedProjectsGraph === 'undefined') {
    throw new PnpmError(
      'RECURSIVE_EXEC_NO_PACKAGE',
      'No package found in this workspace'
    );
  }

  if (typeof opts.resumeFrom === 'string') {
    chunks = getResumedPackageChunks({
      resumeFrom: opts.resumeFrom,
      chunks,
      selectedProjectsGraph: opts.selectedProjectsGraph,
    });
  }

  const result = createEmptyRecursiveSummary(chunks);

  const existsPnp = existsInDir.bind(null, '.pnp.cjs');

  const workspacePnpPath =
    typeof opts.workspaceDir === 'string' && existsPnp(opts.workspaceDir);

  let exitCode = 0;

  const mapPrefixToPrependPaths: Record<ProjectRootDir, string[]> = {};

  await Promise.all(
    chunks.flat().map(async (prefix: ProjectRootDir): Promise<void> => {
      const executionEnv = await prepareExecutionEnv(opts, {
        extraBinPaths: opts.extraBinPaths,
        executionEnv:
          opts.selectedProjectsGraph?.[prefix]?.package.manifest.pnpm
            ?.executionEnv,
      });

      mapPrefixToPrependPaths[prefix] = [
        './node_modules/.bin',
        ...executionEnv.extraBinPaths,
      ];
    })
  );

  const reporterShowPrefix =
    opts.recursive === true && opts.reporterHidePrefix === false;

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (prefix: ProjectRootDir): Promise<void> => {
        return limitRun(async (): Promise<void> => {
          const prependPaths = mapPrefixToPrependPaths[prefix] ?? [];

          const r = result[prefix];

          if (typeof r !== 'undefined') {
            r.status = 'running';
          }

          const startTime = process.hrtime();

          try {
            const pnpPath = workspacePnpPath ?? existsPnp(prefix);

            const extraEnv = {
              ...opts.extraEnv,
              ...(typeof pnpPath === 'string'
                ? makeNodeRequireOption(pnpPath)
                : {}),
            };
            const env = makeEnv({
              extraEnv: {
                ...extraEnv,
                PNPM_PACKAGE_NAME:
                  opts.selectedProjectsGraph?.[prefix]?.package.manifest.name,
                ...(typeof opts.nodeOptions !== 'undefined'
                  ? { NODE_OPTIONS: opts.nodeOptions }
                  : {}),
              },
              prependPaths,
              userAgent: opts.userAgent,
            });

            const [cmd, ...args] = params;

            if (typeof cmd !== 'string') {
              return;
            }

            if (reporterShowPrefix) {
              const manifest = await readProjectManifestOnly(prefix);

              const child = execa(cmd, args, {
                cwd: prefix,
                env,
                stdio: 'pipe',
                shell: opts.shellMode ?? false,
              });

              const lifecycleOpts = {
                wd: prefix,
                depPath: manifest.name || path.relative(opts.dir, prefix),
                stage: '(exec)',
              } satisfies Partial<LifecycleMessage>;

              function logFn(
                stdio: 'stdout' | 'stderr'
              ): (data: unknown) => void {
                return (data: unknown): void => {
                  for (const line of String(data).split('\n')) {
                    lifecycleLogger.debug({
                      ...lifecycleOpts,
                      stdio,
                      line,
                    });
                  }
                };
              }

              child.stdout.on('data', logFn('stdout'));
              child.stderr.on('data', logFn('stderr'));

              void child.once('close', (exitCode: number | null): void => {
                lifecycleLogger.debug({
                  ...lifecycleOpts,
                  exitCode: exitCode ?? 1,
                  optional: false,
                });
              });

              await child;
            } else {
              await execa(cmd, args, {
                cwd: prefix,
                env,
                stdio: 'inherit',
                shell: opts.shellMode ?? false,
              });
            }

            const r = result[prefix];

            if (typeof r !== 'undefined') {
              r.status = 'passed';

              r.duration = getExecutionDuration(startTime);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            const firstParam = params[0];

            if (
              typeof firstParam === 'string' &&
              isErrorCommandNotFound(firstParam, err, prependPaths)
            ) {
              err.message = `Command "${firstParam}" not found`;

              err.hint = await createExecCommandNotFoundHint(firstParam, {
                implicitlyFellbackFromRun:
                  opts.implicitlyFellbackFromRun ?? false,
                dir: opts.dir,
                workspaceDir: opts.workspaceDir,
                modulesDir: opts.modulesDir ?? 'node_modules',
              });
            } else if (
              opts.recursive !== true &&
              typeof err.exitCode === 'number'
            ) {
              exitCode = err.exitCode;

              return;
            }

            logger.info(err);

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

            if (err.code?.startsWith('ERR_PNPM_') !== true) {
              err.code = 'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL';
            }

            err.prefix = prefix;

            if (opts.reportSummary === true) {
              await writeRecursiveSummary({
                dir: opts.lockfileDir, // ?? opts.dir,
                summary: result,
              });
            }

            throw err;
          }
        });
      })
    );
  }

  if (opts.reportSummary === true) {
    await writeRecursiveSummary({
      dir: opts.lockfileDir, // ?? opts.dir,
      summary: result,
    });
  }

  throwOnCommandFail('pnpm recursive exec', result);

  return { exitCode };
}

async function createExecCommandNotFoundHint(
  programName: string,
  opts: {
    dir: string;
    implicitlyFellbackFromRun: boolean;
    workspaceDir?: string | undefined;
    modulesDir: string;
  }
): Promise<string | undefined> {
  if (opts.implicitlyFellbackFromRun) {
    let nearestScript: string | null | undefined;

    try {
      nearestScript = getNearestScript(
        programName,
        (await readProjectManifestOnly(opts.dir)).scripts
      );
    } catch {}

    if (typeof nearestScript === 'string') {
      return `Did you mean "pnpm ${nearestScript}"?`;
    }

    const nearestProgram = getNearestProgram({
      programName,
      dir: opts.dir,
      workspaceDir: opts.workspaceDir,
      modulesDir: opts.modulesDir,
    });

    if (typeof nearestProgram === 'string') {
      return `Did you mean "pnpm ${nearestProgram}"?`;
    }

    return undefined;
  }

  const nearestProgram = getNearestProgram({
    programName,
    dir: opts.dir,
    workspaceDir: opts.workspaceDir,
    modulesDir: opts.modulesDir,
  });

  if (typeof nearestProgram === 'string') {
    return `Did you mean "pnpm exec ${nearestProgram}"?`;
  }

  return undefined;
}

interface CommandError extends Error {
  originalMessage: string;
  shortMessage: string;
}

function isErrorCommandNotFound(
  command: string,
  error: CommandError,
  prependPaths: string[]
): boolean {
  // Mac/Linux
  if (process.platform === 'linux' || process.platform === 'darwin') {
    return error.originalMessage === `spawn ${command} ENOENT`;
  }

  // Windows
  if (process.platform === 'win32') {
    const { value: path } = prependDirsToPath(prependPaths);

    return (
      typeof which.sync(command, {
        nothrow: true,
        path,
      }) !== 'string'
    );
  }

  return false;
}
