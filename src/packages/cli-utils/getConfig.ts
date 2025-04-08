import { packageManager } from '../cli-meta/index.ts';
import {
  getConfig as _getConfig,
  type CliOptions,
  type Config,
} from '../config/index.ts';
import { formatWarn } from '../default-reporter/index.ts';
import type { WorkspaceDir } from '../types/project.ts';

export async function getConfig<IP>(
  cliOptions: CliOptions,
  opts: {
    excludeReporter: boolean;
    globalDirShouldAllowWrite?: boolean | undefined;
    rcOptionsTypes: Record<string, unknown>;
    workspaceDir: WorkspaceDir | undefined;
    checkUnknownSetting?: boolean | undefined;
    ignoreNonAuthSettingsFromLocal?: boolean | undefined;
  }
): Promise<Config> {
  const { config, warnings } = await _getConfig<IP>({
    cliOptions,
    globalDirShouldAllowWrite: opts.globalDirShouldAllowWrite ?? false,
    packageManager,
    rcOptionsTypes: opts.rcOptionsTypes,
    workspaceDir: opts.workspaceDir,
    checkUnknownSetting: opts.checkUnknownSetting ?? false,
    ignoreNonAuthSettingsFromLocal:
      opts.ignoreNonAuthSettingsFromLocal ?? false,
  });

  config.cliOptions = cliOptions;

  if (opts.excludeReporter) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete config.reporter; // This is a silly workaround because @pnpm/core expects a function as opts.reporter
  }

  if (warnings.length > 0) {
    console.warn(warnings.map((warning) => formatWarn(warning)).join('\n'));
  }

  return config;
}
