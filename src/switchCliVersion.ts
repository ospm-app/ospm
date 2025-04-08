import path from 'node:path';
import type { Config } from './packages/config/index.ts';
import { PnpmError } from './packages/error/index.ts';
import { globalWarn } from './packages/logger/index.ts';
import { packageManager } from './packages/cli-meta/index.ts';
import { prependDirsToPath } from './packages/env.path/index.ts';
import { installPnpmToTools } from './packages/tools.plugin-commands-self-updater/index.ts';
import spawn from 'cross-spawn';
import semver from 'semver';
import process from 'node:process';

export async function switchCliVersion(config: Config): Promise<void> {
  const pm = config.wantedPackageManager;
  if (
    pm == null ||
    pm.name !== 'pnpm' ||
    pm.version == null ||
    pm.version === packageManager.version
  ) {
    return;
  }

  const pmVersion = semver.valid(pm.version);

  if (pmVersion == null || pmVersion === '') {
    globalWarn(
      `Cannot switch to pnpm@${pm.version}: "${pm.version}" is not a valid version`
    );

    return;
  }

  if (pmVersion !== pm.version.trim()) {
    globalWarn(
      `Cannot switch to pnpm@${pm.version}: you need to specify the version as "${pmVersion}"`
    );

    return;
  }

  const { binDir: wantedPnpmBinDir } = await installPnpmToTools(
    pmVersion,
    config
  );

  const pnpmEnv = prependDirsToPath([wantedPnpmBinDir]);
  if (!pnpmEnv.updated) {
    // We throw this error to prevent an infinite recursive call of the same pnpm version.
    throw new VersionSwitchFail(pmVersion, wantedPnpmBinDir);
  }

  // Specify the exact pnpm file path that's expected to execute to spawn.sync()
  //
  // It's not safe spawn 'pnpm' (without specifying an absolute path) and expect
  // it to resolve to the same file path computed above due to the $PATH
  // environment variable. While that does happen in most cases, there's a
  // scenario where the wanted pnpm bin dir exists, but no pnpm binary is
  // present within that directory. If that's the case, a different pnpm bin can
  // get executed, causing infinite spawn and fork bombing the user. See details
  // at https://github.com/pnpm/pnpm/pull/8679.
  const pnpmBinPath = path.join(wantedPnpmBinDir, 'pnpm');

  const { status, error } = spawn.sync(pnpmBinPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: {
      ...process.env,
      [pnpmEnv.name]: pnpmEnv.value,
    },
  });

  if (typeof error === 'string') {
    throw new VersionSwitchFail(pmVersion, wantedPnpmBinDir, error);
  }

  // eslint-disable-next-line n/no-process-exit
  process.exit(status ?? 0);
}

class VersionSwitchFail extends PnpmError {
  constructor(version: string, wantedPnpmBinDir: string, cause?: unknown) {
    super(
      'VERSION_SWITCH_FAIL',
      `Failed to switch pnpm to v${version}. Looks like pnpm CLI is missing at "${wantedPnpmBinDir}" or is incorrect`,
      { hint: cause instanceof Error ? cause.message : undefined }
    );

    if (cause != null) {
      this.cause = cause;
    }
  }
}
