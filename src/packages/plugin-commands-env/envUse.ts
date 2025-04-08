import { promises as fs } from 'node:fs';
import util from 'node:util';
import gfs from 'graceful-fs';
import path from 'node:path';
import { PnpmError } from '../error/index.ts';
import cmdShim from '@zkochan/cmd-shim';
import isWindows from 'is-windows';
import symlinkDir from 'symlink-dir';
import type { NvmNodeCommandOptions } from './node.ts';
import {
  CURRENT_NODE_DIRNAME,
  getNodeExecPathInBinDir,
  getNodeExecPathInNodeDir,
} from './utils.ts';
import { downloadNodeVersion } from './downloadNodeVersion.ts';

export async function envUse(
  opts: NvmNodeCommandOptions,
  params: string[]
): Promise<string> {
  if (opts.global !== true) {
    throw new PnpmError(
      'NOT_IMPLEMENTED_YET',
      '"pnpm env use <version>" can only be used with the "--global" option currently'
    );
  }

  const nodeInfo = await downloadNodeVersion(opts, params[0] ?? '');

  if (!nodeInfo) {
    throw new PnpmError(
      'COULD_NOT_RESOLVE_NODEJS',
      `Couldn't find Node.js version matching ${params[0]}`
    );
  }

  const { nodeDir, nodeVersion } = nodeInfo;

  const src = getNodeExecPathInNodeDir(nodeDir);

  const dest = getNodeExecPathInBinDir(opts.bin);

  await symlinkDir(nodeDir, path.join(opts.pnpmHomeDir, CURRENT_NODE_DIRNAME));

  try {
    gfs.unlinkSync(dest);
  } catch (err: unknown) {
    if (
      !(util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT')
    ) {
      throw err;
    }
  }

  await symlinkOrHardLink(src, dest);

  try {
    let npmDir = nodeDir;

    if (process.platform !== 'win32') {
      npmDir = path.join(npmDir, 'lib');
    }

    npmDir = path.join(npmDir, 'node_modules/npm');

    if (typeof opts.configDir === 'string') {
      // We want the global npm settings to persist when Node.js or/and npm is changed to a different version,
      // so we tell npm to read the global config from centralized place that is outside of npm's directory.
      await fs.writeFile(
        path.join(npmDir, 'npmrc'),
        `globalconfig=${path.join(opts.configDir, 'npmrc')}`,
        'utf-8'
      );
    }

    const npmBinDir = path.join(npmDir, 'bin');

    const cmdShimOpts = { createPwshFile: false };

    await cmdShim(
      path.join(npmBinDir, 'npm-cli.js'),
      path.join(opts.bin, 'npm'),
      cmdShimOpts
    );

    await cmdShim(
      path.join(npmBinDir, 'npx-cli.js'),
      path.join(opts.bin, 'npx'),
      cmdShimOpts
    );
  } catch {
    // ignore
  }

  return `Node.js ${nodeVersion as string} was activated ${dest} -> ${src}`;
}

// On Windows, symlinks only work with developer mode enabled
// or with admin permissions. So it is better to use hard links on Windows.
async function symlinkOrHardLink(
  existingPath: string,
  newPath: string
): Promise<void> {
  if (isWindows()) {
    return fs.link(existingPath, newPath);
  }
  return fs.symlink(existingPath, newPath, 'file');
}
