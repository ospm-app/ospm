import util from 'node:util';
import assert from 'node:assert';
import { OspmError } from '../error/index.ts';
import { globalInfo, logger } from '../logger/index.ts';
import { removeBin } from '../remove-bins/index.ts';
import rimraf from '@zkochan/rimraf';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getNodeVersion } from './downloadNodeVersion.ts';
import { getNodeVersionsBaseDir, type NvmNodeCommandOptions } from './node.ts';
import { getNodeExecPathAndTargetDir } from './utils.ts';

export async function envRemove(
  opts: NvmNodeCommandOptions,
  params: string[]
): Promise<{ exitCode: number }> {
  if (opts.global !== true) {
    throw new OspmError(
      'NOT_IMPLEMENTED_YET',
      '"ospm env remove <version>" can only be used with the "--global" option currently'
    );
  }

  let failed = false;

  for (const version of params) {
    const err = await removeNodeVersion(opts, version);

    if (err) {
      logger.error(err);
      failed = true;
    }
  }

  return { exitCode: failed ? 1 : 0 };
}

async function removeNodeVersion(
  opts: NvmNodeCommandOptions,
  version: string
): Promise<Error | undefined> {
  const { nodeVersion } = await getNodeVersion(opts, version);

  const nodeDir = getNodeVersionsBaseDir(opts.ospmHomeDir);

  if (typeof nodeVersion !== 'string' || nodeVersion === '') {
    return new OspmError(
      'COULD_NOT_RESOLVE_NODEJS',
      `Couldn't find Node.js version matching ${version}`
    );
  }

  const versionDir = path.resolve(nodeDir, nodeVersion);

  if (!existsSync(versionDir)) {
    return new OspmError(
      'ENV_NO_NODE_DIRECTORY',
      `Couldn't find Node.js directory in ${versionDir}`
    );
  }

  const { nodePath, nodeLink } = await getNodeExecPathAndTargetDir(
    opts.ospmHomeDir
  );

  if (nodeLink?.includes(versionDir) === true) {
    globalInfo(
      `Node.js ${nodeVersion as string} was detected as the default one, removing ...`
    );

    const npmPath = path.resolve(opts.ospmHomeDir, 'npm');

    const npxPath = path.resolve(opts.ospmHomeDir, 'npx');

    try {
      await Promise.all([
        removeBin(nodePath),
        removeBin(npmPath),
        removeBin(npxPath),
      ]);
    } catch (err: unknown) {
      assert(util.types.isNativeError(err));

      if (!('code' in err && err.code === 'ENOENT')) return err;
    }
  }

  await rimraf(versionDir);

  globalInfo(`Node.js ${nodeVersion as string} was removed ${versionDir}`);

  return;
}
