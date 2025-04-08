import type { PackageManifest, ProjectManifest } from '../types/index.ts';
import path from 'node:path';
import { readPkg } from './readPkg.ts';

type PkgData = {
  alias?: string | undefined;
  name: string;
  version: string;
  path: string;
  resolved?: string | undefined;
};

export type PkgInfo = Omit<PkgData, 'name'> &
  Pick<ProjectManifest, 'description' | 'license' | 'author' | 'homepage'> & {
    from: string;
    repository?: string | undefined;
  };

export async function getPkgInfo(pkg: PkgData): Promise<PkgInfo> {
  let manifest: PackageManifest;

  try {
    manifest = await readPkg(path.join(pkg.path, 'package.json'));
  } catch {
    // This will probably never happen
    manifest = {
      description: '[Could not find additional info about this dependency]',
      name: pkg.name,
      version: pkg.version,
    };
  }

  return {
    alias: pkg.alias,
    from: pkg.name,

    version: pkg.version,

    resolved: pkg.resolved,

    description: manifest.description,
    license: manifest.license,
    author: manifest.author,

    homepage: manifest.homepage,
    repository:
      typeof manifest.repository !== 'undefined'
        ? typeof manifest.repository === 'string'
          ? manifest.repository
          : manifest.repository.url
        : undefined,
    path: pkg.path,
  };
}
