import fs from 'node:fs';
import getRegistryName from 'encode-registry';
import { glob } from 'tinyglobby';

export async function cacheListRegistries(opts: {
  cacheDir: string;
  registry?: string | undefined;
  registries?: boolean | undefined;
}): Promise<string> {
  return fs.readdirSync(opts.cacheDir).sort().join('\n');
}

export async function cacheList(
  opts: {
    cacheDir: string;
    registry?: string | undefined;
    registries?: boolean | undefined;
  },
  filter: string[]
): Promise<string> {
  const metaFiles = await findMetadataFiles(opts, filter);
  return metaFiles.sort().join('\n');
}

export async function findMetadataFiles(
  opts: { cacheDir: string; registry?: string | undefined },
  filter: string[]
): Promise<string[]> {
  const prefix =
    typeof opts.registry === 'string'
      ? `${getRegistryName(opts.registry)}`
      : '*';

  const patterns = filter.length
    ? filter.map((filter) => `${prefix}/${filter}.json`)
    : [`${prefix}/**`];

  return await glob(patterns, {
    cwd: opts.cacheDir,
    expandDirectories: false,
  });
}
