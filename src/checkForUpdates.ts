import path from 'node:path';
import { packageManager } from './packages/cli-meta/index.ts';
import type { Config } from './packages/config/index.ts';
import { createResolver } from './packages/client/index.ts';
import { pickRegistryForPackage } from './packages/pick-registry-for-package/index.ts';
import { updateCheckLogger } from './packages/core-loggers/index.ts';
import { loadJsonFile } from 'load-json-file';
import { writeJsonFile } from 'write-json-file';

type State = {
  lastUpdateCheck?: string | undefined;
};

const UPDATE_CHECK_FREQUENCY = 24 * 60 * 60 * 1000; // 1 day

export async function checkForUpdates(config: Config): Promise<void> {
  const stateFile = path.join(config.stateDir, 'pnpm-state.json');

  let state: State | undefined;

  try {
    state = await loadJsonFile(stateFile);
  } catch {}

  if (
    typeof state?.lastUpdateCheck === 'string' &&
    Date.now() - new Date(state.lastUpdateCheck).valueOf() <
      UPDATE_CHECK_FREQUENCY
  ) {
    return;
  }

  const { resolve } = createResolver({
    ...config,
    authConfig: config.rawConfig,
    retry: {
      retries: 0,
    },
  });

  const resolution = await resolve(
    { alias: packageManager.name, pref: 'latest' },
    {
      lockfileDir: config.lockfileDir, // ?? config.dir,
      preferredVersions: {},
      projectDir: config.dir,
      registry: pickRegistryForPackage(
        config.registries,
        packageManager.name,
        'latest'
      ),
    }
  );

  if (typeof resolution.manifest?.version === 'string') {
    updateCheckLogger.debug({
      currentVersion: packageManager.version,
      latestVersion: resolution.manifest.version,
    });
  }

  await writeJsonFile(stateFile, {
    ...state,
    lastUpdateCheck: new Date().toUTCString(),
  });
}
