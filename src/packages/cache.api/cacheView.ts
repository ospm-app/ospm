import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { getIndexFilePathInCafs } from '../store.cafs/index.ts';
import getRegistryName from 'encode-registry';
import type { PackageMeta } from '../default-resolver/index.ts';

type CachedVersions = {
  cachedVersions: string[];
  nonCachedVersions: string[];
  cachedAt?: string | undefined;
  distTags: Record<string, string>;
};

export async function cacheView(
  opts: { cacheDir: string; storeDir: string; registry?: string | undefined },
  packageName: string
): Promise<string> {
  const prefix =
    typeof opts.registry === 'string'
      ? `${getRegistryName(opts.registry)}`
      : '*';

  const metaFilePaths = (
    await glob(`${prefix}/${packageName}.json`, {
      cwd: opts.cacheDir,
      expandDirectories: false,
    })
  ).sort();

  const metaFilesByPath: Record<string, CachedVersions> = {};

  for (const filePath of metaFilePaths) {
    // TODO: validate with valibot
    const metaObject: PackageMeta = JSON.parse(
      fs.readFileSync(path.join(opts.cacheDir, filePath), 'utf8')
    ) as PackageMeta;

    const cachedVersions: string[] = [];

    const nonCachedVersions: string[] = [];

    for (const [version, manifest] of Object.entries(
      metaObject.versions ?? {}
    )) {
      if (typeof manifest.dist.integrity === 'undefined') {
        continue;
      }

      const indexFilePath = getIndexFilePathInCafs(
        opts.storeDir,
        manifest.dist.integrity,
        `${manifest.name}@${manifest.version}`
      );

      if (fs.existsSync(indexFilePath)) {
        cachedVersions.push(version);
      } else {
        nonCachedVersions.push(version);
      }
    }

    let registryName = filePath;

    while (path.dirname(registryName) !== '.') {
      registryName = path.dirname(registryName);
    }

    metaFilesByPath[registryName.replaceAll('+', ':')] = {
      cachedVersions,
      nonCachedVersions,
      cachedAt:
        typeof metaObject.cachedAt === 'number'
          ? new Date(metaObject.cachedAt).toString()
          : undefined,
      distTags: metaObject['dist-tags'],
    };
  }

  return JSON.stringify(metaFilesByPath, null, 2);
}
