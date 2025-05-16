import path from 'node:path';
import { lifecycleLogger } from '../core-loggers/index.ts';
import { globalWarn } from '../logger/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import lifecycle from '@pnpm/npm-lifecycle';
import type {
  DependencyManifest,
  ProjectManifest,
  PrepareExecutionEnv,
  PackageScripts,
} from '../types/index.ts';
import { OspmError } from '../error/index.ts';
import { existsSync } from 'node:fs';
import isWindows from 'is-windows';
import { quote as shellQuote } from 'shell-quote';

function noop(): void {}

export type RunLifecycleHookOptions = {
  args?: string[] | undefined;
  depPath: string;
  extraBinPaths?: string[] | undefined;
  extraEnv?: Record<string, string> | undefined;
  initCwd?: string | undefined;
  optional?: boolean | undefined;
  pkgRoot: string;
  rawConfig: object;
  rootModulesDir?: string | undefined;
  scriptShell?: string | undefined;
  silent?: boolean | undefined;
  scriptsPrependNodePath?: boolean | 'warn-only' | undefined;
  shellEmulator?: boolean | undefined;
  stdio?: string | undefined;
  unsafePerm: boolean;
  prepareExecutionEnv?: PrepareExecutionEnv | undefined;
};

export async function runLifecycleHook(
  stage: string,
  manifest: ProjectManifest | DependencyManifest,
  opts: RunLifecycleHookOptions
): Promise<boolean> {
  const optional = opts.optional === true;

  // To remediate CVE_2024_27980, Node.js does not allow .bat or .cmd files to
  // be spawned without the "shell: true" option.
  //
  // https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows
  //
  // Unfortunately, setting spawn's shell option also causes arguments to be
  // evaluated before they're passed to the shell, resulting in a surprising
  // behavior difference only with .bat/.cmd files.
  //
  // Instead of showing a "spawn EINVAL" error, let's throw a clearer error that
  // this isn't supported.
  //
  // If this behavior needs to be supported in the future, the arguments would
  // need to be escaped before they're passed to the .bat/.cmd file. For
  // example, scripts such as "echo %PATH%" should be passed verbatim rather
  // than expanded. This is difficult to do correctly. Other open source tools
  // (e.g. Rust) attempted and introduced bugs. The Rust blog has a good
  // high-level explanation of the same security vulnerability Node.js patched.
  //
  // https://blog.rust-lang.org/2024/04/09/cve-2024-24576.html#overview
  //
  // Note that npm (as of version 10.5.0) doesn't support setting script-shell
  // to a .bat or .cmd file either.
  if (opts.scriptShell != null && isWindowsBatchFile(opts.scriptShell)) {
    throw new OspmError(
      'ERR_OSPM_INVALID_SCRIPT_SHELL_WINDOWS',
      'Cannot spawn .bat or .cmd as a script shell.',
      {
        hint: `\
The .npmrc script-shell option was configured to a .bat or .cmd file. These cannot be used as a script shell reliably.

Please unset the script-shell option, or configure it to a .exe instead.
`,
      }
    );
  }

  const m = { _id: getId(manifest), ...manifest };
  m.scripts = { ...m.scripts };

  switch (stage) {
    case 'start': {
      if (typeof m.scripts.start === 'undefined') {
        if (!existsSync('server.js')) {
          throw new OspmError(
            'NO_SCRIPT_OR_SERVER',
            'Missing script start or file server.js'
          );
        }

        m.scripts.start = 'node server.js';
      }

      break;
    }

    case 'install': {
      if (
        typeof m.scripts.install === 'undefined' &&
        typeof m.scripts.preinstall === 'undefined'
      ) {
        checkBindingGyp(opts.pkgRoot, m.scripts);
      }

      break;
    }
  }

  if (
    typeof opts.args?.length === 'number' &&
    opts.args.length > 0 &&
    typeof m.scripts[stage] === 'string'
  ) {
    // It is impossible to quote a command line argument that contains newline for Windows cmd.
    const escapedArgs = isWindows()
      ? opts.args.map((arg) => JSON.stringify(arg)).join(' ')
      : shellQuote(opts.args);

    m.scripts[stage] = `${m.scripts[stage]} ${escapedArgs}`;
  }

  // This script is used to prevent the usage of npm or Yarn.
  // It does nothing, when ospm is used, so we may skip its execution.
  if (
    m.scripts[stage] === 'npx only-allow ospm' ||
    typeof m.scripts[stage] === 'undefined'
  ) {
    return false;
  }

  if (opts.stdio !== 'inherit') {
    lifecycleLogger.debug({
      depPath: opts.depPath,
      optional,
      script: m.scripts[stage],
      stage,
      wd: opts.pkgRoot,
    });
  }

  const logLevel =
    opts.stdio !== 'inherit' || opts.silent === true ? 'silent' : undefined;

  const extraBinPaths =
    (
      await opts.prepareExecutionEnv?.({
        extraBinPaths: opts.extraBinPaths,
        executionEnv: (manifest as ProjectManifest).ospm?.executionEnv,
      })
    )?.extraBinPaths ?? opts.extraBinPaths;

  await lifecycle(m, stage, opts.pkgRoot, {
    config: {
      ...opts.rawConfig,
      'frozen-lockfile': false,
    },
    dir: opts.rootModulesDir,
    extraBinPaths,
    extraEnv: {
      ...opts.extraEnv,
      INIT_CWD: opts.initCwd ?? process.cwd(),
      OSPM_SCRIPT_SRC_DIR: opts.pkgRoot,
    },
    log: {
      clearProgress: noop,
      info: noop,
      level: logLevel,
      pause: noop,
      resume: noop,
      showProgress: noop,
      silly: npmLog,
      verbose: npmLog,
      warn: (...msg: string[]) => {
        globalWarn(msg.join(' '));
      },
    },
    runConcurrently: true,
    scriptsPrependNodePath: opts.scriptsPrependNodePath,
    scriptShell: opts.scriptShell,
    shellEmulator: opts.shellEmulator,
    stdio: opts.stdio ?? 'pipe',
    unsafePerm: opts.unsafePerm,
  });

  return true;

  function npmLog(
    _prefix: string,
    _logId: string,
    stdtype: string,
    line: string
  ): void {
    switch (stdtype) {
      case 'stdout':
      case 'stderr': {
        lifecycleLogger.debug({
          depPath: opts.depPath,
          line: line.toString(),
          stage,
          stdio: stdtype,
          wd: opts.pkgRoot,
        });

        return;
      }

      case 'Returned: code:': {
        if (opts.stdio === 'inherit') {
          // Preventing the ospm reporter from overriding the project's script output
          return;
        }

        // biome-ignore lint/style/noArguments: <explanation>
        const code = arguments[3] ?? 1;

        lifecycleLogger.debug({
          depPath: opts.depPath,
          exitCode: code,
          optional,
          stage,
          wd: opts.pkgRoot,
        });
      }
    }
  }
}

function checkBindingGyp(root: string, scripts: PackageScripts): void {
  if (existsSync(path.join(root, 'binding.gyp'))) {
    scripts.install = 'node-gyp rebuild';
  }
}

function getId(manifest: ProjectManifest | DependencyManifest): string {
  return `${manifest.name}@${manifest.version}`;
}

function isWindowsBatchFile(scriptShell: string): boolean {
  // Node.js performs a similar check to determine whether it should throw
  // EINVAL when spawning a .cmd/.bat file.
  //
  // https://github.com/nodejs/node/commit/6627222409#diff-1e725bfa950eda4d4b5c0c00a2bb6be3e5b83d819872a1adf2ef87c658273903
  const scriptShellLower = scriptShell.toLowerCase();

  return (
    isWindows() &&
    (scriptShellLower.endsWith('.cmd') || scriptShellLower.endsWith('.bat'))
  );
}
