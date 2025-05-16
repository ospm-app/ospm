import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import type { Config } from '../config/index.ts';
import { getSystemNodeVersion } from '../env.system-node-version/index.ts';
import {
  createFetchFromRegistry,
  type FetchFromRegistry,
} from '../fetch/index.ts';
import { globalInfo } from '../logger/index.ts';
import { fetchNode } from '../node.fetcher/index.ts';
import { getStorePath } from '../store-path/index.ts';
import type {
  PrepareExecutionEnvOptions,
  PrepareExecutionEnvResult,
} from '../types/index.ts';
import { loadJsonFile } from 'load-json-file';
import { writeJsonFile } from 'write-json-file';
import { getNodeMirror } from './getNodeMirror.ts';
import { parseNodeSpecifier } from './parseNodeSpecifier.ts';

export type NvmNodeCommandOptions = Pick<
  Config,
  | 'bin'
  | 'global'
  | 'fetchRetries'
  | 'fetchRetryFactor'
  | 'fetchRetryMaxtimeout'
  | 'fetchRetryMintimeout'
  | 'fetchTimeout'
  | 'userAgent'
  | 'ca'
  | 'cert'
  | 'httpProxy'
  | 'httpsProxy'
  | 'key'
  | 'localAddress'
  | 'noProxy'
  | 'rawConfig'
  | 'strictSsl'
  | 'storeDir'
  | 'useNodeVersion'
  | 'ospmHomeDir'
> &
  Partial<Pick<Config, 'configDir' | 'cliOptions' | 'sslConfigs'>> & {
    remote?: boolean | undefined;
  };

const nodeFetchPromises: Record<string, Promise<string>> = {};

export async function prepareExecutionEnv(
  config: NvmNodeCommandOptions,
  { extraBinPaths, executionEnv }: PrepareExecutionEnvOptions
): Promise<PrepareExecutionEnvResult> {
  if (
    typeof executionEnv?.nodeVersion === 'undefined' ||
    `v${executionEnv.nodeVersion}` === (await getSystemNodeVersion())
  ) {
    return { extraBinPaths: extraBinPaths ?? [] };
  }

  let nodePathPromise = nodeFetchPromises[executionEnv.nodeVersion];

  if (!nodePathPromise) {
    nodePathPromise = getNodeBinDir({
      ...config,
      useNodeVersion: executionEnv.nodeVersion,
    });

    nodeFetchPromises[executionEnv.nodeVersion] = nodePathPromise;
  }

  return {
    extraBinPaths: [await nodePathPromise, ...(extraBinPaths ?? [])],
  };
}

export async function getNodeBinDir(
  opts: NvmNodeCommandOptions
): Promise<string> {
  const fetch = createFetchFromRegistry(opts);

  const nodesDir = getNodeVersionsBaseDir(opts.ospmHomeDir);

  let wantedNodeVersion =
    opts.useNodeVersion ?? (await readNodeVersionsManifest(nodesDir)).default;

  if (wantedNodeVersion == null) {
    const response = await fetch('https://registry.npmjs.org/node');

    wantedNodeVersion = ((await response.json()) as any)['dist-tags'].lts; // eslint-disable-line

    if (wantedNodeVersion == null) {
      throw new Error('Could not resolve LTS version of Node.js');
    }

    await writeJsonFile(path.join(nodesDir, 'versions.json'), {
      default: wantedNodeVersion,
    });
  }

  const { useNodeVersion, releaseChannel } =
    parseNodeSpecifier(wantedNodeVersion);

  const nodeMirrorBaseUrl = getNodeMirror(opts.rawConfig, releaseChannel);

  const nodeDir = await getNodeDir(fetch, {
    ...opts,
    useNodeVersion,
    nodeMirrorBaseUrl,
  });

  return process.platform === 'win32' ? nodeDir : path.join(nodeDir, 'bin');
}

export function getNodeVersionsBaseDir(ospmHomeDir: string): string {
  return path.join(ospmHomeDir, 'nodejs');
}

export async function getNodeDir(
  fetch: FetchFromRegistry,
  opts: NvmNodeCommandOptions & {
    useNodeVersion: string;
    nodeMirrorBaseUrl: string;
  }
): Promise<string> {
  const nodesDir = getNodeVersionsBaseDir(opts.ospmHomeDir);

  await fs.promises.mkdir(nodesDir, { recursive: true });

  const versionDir = path.join(nodesDir, opts.useNodeVersion);

  if (!fs.existsSync(versionDir)) {
    const storeDir = await getStorePath({
      pkgRoot: process.cwd(),
      storePath: opts.storeDir,
      ospmHomeDir: opts.ospmHomeDir,
    });

    globalInfo(`Fetching Node.js ${opts.useNodeVersion} ...`);

    await fetchNode(fetch, opts.useNodeVersion, versionDir, {
      ...opts,
      storeDir,
      retry: {
        maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
        minTimeout: opts.fetchRetryMintimeout ?? 10_000,
        retries: opts.fetchRetries ?? 2,
        factor: opts.fetchRetryFactor ?? 10,
      },
    });
  }

  return versionDir;
}

async function readNodeVersionsManifest(
  nodesDir: string
): Promise<{ default?: string }> {
  try {
    return await loadJsonFile<{ default?: string }>(
      path.join(nodesDir, 'versions.json')
    );
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return {};
    }

    throw err;
  }
}
