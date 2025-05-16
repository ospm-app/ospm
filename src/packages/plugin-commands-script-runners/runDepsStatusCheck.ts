import type { VerifyDepsBeforeRun } from '../config/index.ts';
import { OspmError } from '../error/index.ts';
import { runOspmCli } from '../exec.pnpm-cli-runner/index.ts';
import { globalWarn } from '../logger/index.ts';
import {
  checkDepsStatus,
  type CheckDepsStatusOptions,
  type WorkspaceStateSettings,
} from '../deps.status/index.ts';
import { prompt } from 'enquirer';

export type RunDepsStatusCheckOptions = CheckDepsStatusOptions & {
  dir: string;
  verifyDepsBeforeRun?: VerifyDepsBeforeRun | undefined;
};

export async function runDepsStatusCheck(
  opts: RunDepsStatusCheckOptions
): Promise<void> {
  // the following flags are always the default values during `ospm run` and `ospm exec`,
  // so they may not match the workspace state after `ospm install --production|--no-optional`
  const ignoredWorkspaceStateSettings = [
    'dev',
    'optional',
    'production',
  ] satisfies Array<keyof WorkspaceStateSettings>;
  opts.ignoredWorkspaceStateSettings = ignoredWorkspaceStateSettings;

  const { upToDate, issue, workspaceState } = await checkDepsStatus(opts);

  if (upToDate === true) {
    return;
  }

  const command = ['install', ...createInstallArgs(workspaceState?.settings)];

  const install = runOspmCli.bind(null, command, { cwd: opts.dir });

  switch (opts.verifyDepsBeforeRun) {
    case 'install': {
      install();

      break;
    }

    case 'prompt': {
      const confirmed = await prompt<{ runInstall: boolean }>({
        type: 'confirm',
        name: 'runInstall',
        message: `Your "node_modules" directory is out of sync with the "ospm-lock.yaml" file. This can lead to issues during scripts execution.

Would you like to run "ospm ${command.join(' ')}" to update your "node_modules"?`,
        initial: true,
      });

      if (confirmed.runInstall) {
        install();
      }

      break;
    }

    case 'error': {
      throw new OspmError(
        'VERIFY_DEPS_BEFORE_RUN',
        issue ?? 'Your node_modules are out of sync with your lockfile',
        {
          hint: 'Run "ospm install"',
        }
      );
    }

    case 'warn': {
      globalWarn(
        `Your node_modules are out of sync with your lockfile. ${issue}`
      );

      break;
    }
  }
}

export function createInstallArgs(
  opts:
    | Pick<WorkspaceStateSettings, 'dev' | 'optional' | 'production'>
    | undefined
): string[] {
  const args: string[] = [];

  if (!opts) {
    return args;
  }

  const { dev, optional, production } = opts;

  if (production === true && dev !== true) {
    args.push('--production');
  } else if (dev === true && production !== true) {
    args.push('--dev');
  }

  if (optional !== true) {
    args.push('--no-optional');
  }

  return args;
}
