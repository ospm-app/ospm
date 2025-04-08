import type { SpawnSyncReturns } from 'node:child_process';
import { packageManager } from './packages/cli-meta/index.ts';
import { getConfig, types as allTypes } from './packages/config/index.ts';
import { runNpm as _runNpm } from './packages/run-npm/index.ts';
import pick from 'ramda/src/pick';

export async function runNpm(
  args: string[]
): Promise<SpawnSyncReturns<Buffer>> {
  const { config } = await getConfig({
    cliOptions: {},
    packageManager,
    rcOptionsTypes: {
      ...pick.default(['npm-path'], allTypes),
    },
  });

  return _runNpm(config.npmPath, args);
}
