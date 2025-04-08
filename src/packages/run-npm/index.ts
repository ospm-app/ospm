import type childProcess from 'node:child_process';
import path from 'node:path';
import spawn from 'cross-spawn';
import process from 'node:process';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PATH from 'path-name';

export interface RunNPMOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export function runNpm(
  npmPath: string | undefined,
  args: string[],
  options?: RunNPMOptions
): childProcess.SpawnSyncReturns<Buffer> {
  const npm = npmPath ?? 'npm';
  return runScriptSync(npm, args, {
    cwd: options?.cwd ?? process.cwd(),
    stdio: 'inherit',
    userAgent: undefined,
    env: { ...options?.env, COREPACK_ENABLE_STRICT: '0' },
  });
}

export function runScriptSync(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    stdio: childProcess.StdioOptions;
    userAgent?: string | undefined;
    env: Record<string, string>;
  }
): childProcess.SpawnSyncReturns<Buffer> {
  const env = {
    ...createEnv(opts),
    ...opts.env,
  };
  const result = spawn.sync(command, args, {
    ...opts,
    env,
  });
  if (result.error) throw result.error;
  return result;
}

function createEnv(opts: {
  cwd: string;
  userAgent?: string | undefined;
}): NodeJS.ProcessEnv {
  const env = { ...process.env };

  env[PATH] = [
    path.join(opts.cwd, 'node_modules', '.bin'),
    path.dirname(process.execPath),
    process.env[PATH],
  ].join(path.delimiter);

  if (typeof opts.userAgent === 'string' && opts.userAgent !== '') {
    env.npm_config_user_agent = opts.userAgent;
  }

  return env;
}
