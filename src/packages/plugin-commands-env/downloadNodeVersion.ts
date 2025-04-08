import { resolveNodeVersion } from '../node.resolver/index.ts';
import { getNodeMirror } from './getNodeMirror.ts';
import { getNodeDir, type NvmNodeCommandOptions } from './node.ts';
import { parseEnvSpecifier } from './parseEnvSpecifier.ts';
import { createFetchFromRegistry } from '../fetch/index.ts';
import { globalInfo } from '../logger/index.ts';

export type GetNodeVersionResult = {
  nodeVersion: string | null;
  nodeMirrorBaseUrl: string;
  releaseChannel: string;
  versionSpecifier: string;
};

export async function getNodeVersion(
  opts: NvmNodeCommandOptions,
  envSpecifier: string
): Promise<GetNodeVersionResult> {
  const fetch = createFetchFromRegistry(opts);

  const { releaseChannel, versionSpecifier } = parseEnvSpecifier(envSpecifier);

  const nodeMirrorBaseUrl = getNodeMirror(opts.rawConfig, releaseChannel);

  const nodeVersion = await resolveNodeVersion(
    fetch,
    versionSpecifier,
    nodeMirrorBaseUrl
  );

  return { nodeVersion, nodeMirrorBaseUrl, releaseChannel, versionSpecifier };
}

export type DownloadNodeVersionResult = {
  nodeVersion: string;
  nodeDir: string;
  nodeMirrorBaseUrl: string;
};

export async function downloadNodeVersion(
  opts: NvmNodeCommandOptions,
  envSpecifier: string
): Promise<DownloadNodeVersionResult | null> {
  const fetch = createFetchFromRegistry(opts);
  const { nodeVersion, nodeMirrorBaseUrl } = await getNodeVersion(
    opts,
    envSpecifier
  );

  if (nodeVersion === null || nodeVersion === '') {
    return null;
  }

  const nodeDir = await getNodeDir(fetch, {
    ...opts,
    useNodeVersion: nodeVersion,
    nodeMirrorBaseUrl,
  });

  globalInfo(`Node.js ${nodeVersion as string} was installed ${nodeDir}`);

  return { nodeVersion, nodeDir, nodeMirrorBaseUrl };
}
