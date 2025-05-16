import path from 'node:path';
import type { Config } from './packages/config/index.ts';
import { OspmError } from './packages/error/index.ts';
import { globalWarn } from './packages/logger/index.ts';
import { packageManager } from './packages/cli-meta/index.ts';
import { prependDirsToPath } from './packages/env.path/index.ts';
import { installOspmToTools } from './packages/tools.plugin-commands-self-updater/index.ts';
import spawn from 'cross-spawn';
import semver from 'semver';
import process from 'node:process';

export async function switchCliVersion(config: Config): Promise<void> {
  const pm = config.wantedPackageManager;
  if (
    pm == null ||
    pm.name !== 'ospm' ||
    pm.version == null ||
    pm.version === packageManager.version
  ) {
    return;
  }

  const pmVersion = semver.valid(pm.version);

  if (pmVersion == null || pmVersion === '') {
    globalWarn(
      `Cannot switch to ospm@${pm.version}: "${pm.version}" is not a valid version`
    );

    return;
  }

  if (pmVersion !== pm.version.trim()) {
    globalWarn(
      `Cannot switch to ospm@${pm.version}: you need to specify the version as "${pmVersion}"`
    );

    return;
  }

  const { binDir: wantedOspmBinDir } = await installOspmToTools(
    pmVersion,
    config
  );

  const ospmEnv = prependDirsToPath([wantedOspmBinDir]);
  if (!ospmEnv.updated) {
    // We throw this error to prevent an infinite recursive call of the same ospm version.
    throw new VersionSwitchFail(pmVersion, wantedOspmBinDir);
  }

  // Specify the exact ospm file path that's expected to execute to spawn.sync()
  //
  // It's not safe spawn 'ospm' (without specifying an absolute path) and expect
  // it to resolve to the same file path computed above due to the $PATH
  // environment variable. While that does happen in most cases, there's a
  // scenario where the wanted ospm bin dir exists, but no ospm binary is
  // present within that directory. If that's the case, a different ospm bin can
  // get executed, causing infinite spawn and fork bombing the user. See details
  // at https://github.com/pnpm/pnpm/pull/8679.
  const ospmBinPath = path.join(wantedOspmBinDir, 'ospm');

  const { status, error } = spawn.sync(ospmBinPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: {
      ...process.env,
      [ospmEnv.name]: ospmEnv.value,
    },
  });

  if (typeof error === 'string') {
    throw new VersionSwitchFail(pmVersion, wantedOspmBinDir, error);
  }

  // eslint-disable-next-line n/no-process-exit
  process.exit(status ?? 0);
}

class VersionSwitchFail extends OspmError {
  constructor(version: string, wantedOspmBinDir: string, cause?: unknown) {
    super(
      'VERSION_SWITCH_FAIL',
      `Failed to switch ospm to v${version}. Looks like ospm CLI is missing at "${wantedOspmBinDir}" or is incorrect`,
      { hint: cause instanceof Error ? cause.message : undefined }
    );

    if (cause != null) {
      this.cause = cause;
    }
  }
}
