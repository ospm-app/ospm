import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { createFetchFromRegistry } from '../fetch/index.ts';
import { OspmError } from '../error/index.ts';
import { resolveNodeVersions } from '../node.resolver/index.ts';
import semver from 'semver';
import { getNodeMirror } from './getNodeMirror.ts';
import { getNodeVersionsBaseDir, type NvmNodeCommandOptions } from './node.ts';
import { parseEnvSpecifier } from './parseEnvSpecifier.ts';
import {
  getNodeExecPathAndTargetDir,
  getNodeExecPathInNodeDir,
} from './utils.ts';

export async function envList(
  opts: NvmNodeCommandOptions,
  params: string[]
): Promise<string> {
  if (opts.remote === true) {
    const nodeVersionList = await listRemoteVersions(opts, params[0]);
    // Make the newest version located in the end of output
    return nodeVersionList.reverse().join('\n');
  }

  const { currentVersion, versions } = await listLocalVersions(opts);

  return versions
    .map(
      (nodeVersion) =>
        `${nodeVersion === currentVersion ? '*' : ' '} ${nodeVersion}`
    )
    .join('\n');
}

type LocalVersions = {
  currentVersion: string | undefined;
  versions: string[];
};

async function listLocalVersions(
  opts: NvmNodeCommandOptions
): Promise<LocalVersions> {
  const nodeBaseDir = getNodeVersionsBaseDir(opts.ospmHomeDir);
  if (!existsSync(nodeBaseDir)) {
    throw new OspmError(
      'ENV_NO_NODE_DIRECTORY',
      `Couldn't find Node.js directory in ${nodeBaseDir}`
    );
  }
  const { nodeLink } = await getNodeExecPathAndTargetDir(opts.ospmHomeDir);
  const nodeVersionDirs = await fs.readdir(nodeBaseDir);
  let currentVersion: string | undefined;
  const versions: string[] = [];
  for (const nodeVersion of nodeVersionDirs) {
    const nodeVersionDir = path.join(nodeBaseDir, nodeVersion);
    const nodeExec = getNodeExecPathInNodeDir(nodeVersionDir);
    if (nodeLink?.startsWith(nodeVersionDir) === true) {
      currentVersion = nodeVersion;
    }
    if (semver.valid(nodeVersion) != null && existsSync(nodeExec)) {
      versions.push(nodeVersion);
    }
  }

  return { currentVersion, versions };
}

async function listRemoteVersions(
  opts: NvmNodeCommandOptions,
  versionSpec?: string
): Promise<string[]> {
  const fetch = createFetchFromRegistry(opts);

  const { releaseChannel, versionSpecifier } = parseEnvSpecifier(
    versionSpec ?? ''
  );

  const nodeMirrorBaseUrl = getNodeMirror(opts.rawConfig, releaseChannel);

  const nodeVersionList = await resolveNodeVersions(
    fetch,
    versionSpecifier,
    nodeMirrorBaseUrl
  );

  return nodeVersionList;
}
