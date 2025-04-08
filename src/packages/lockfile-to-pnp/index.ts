import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import type { Registries } from '../types/index.ts';
import { depPathToFilename, refToRelative } from '../dependency-path/index.ts';
import {
  generateInlinedScript,
  LinkType,
  type PackageRegistry,
  type PackageStore,
} from '@yarnpkg/pnp';
import type { PortablePath } from '@yarnpkg/fslib';
import normalizePath from 'normalize-path';
import type { LockfileObject } from '../lockfile.types/index.ts';

export async function writePnpFile(
  lockfile: LockfileObject,
  opts: {
    importerNames: Record<string, string>;
    lockfileDir: string;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    registries: Registries;
  }
): Promise<void> {
  const packageRegistry = lockfileToPackageRegistry(lockfile, opts);

  const loaderFile = generateInlinedScript({
    dependencyTreeRoots: [],
    ignorePattern: null,
    packageRegistry,
    shebang: null,
  });

  await fs.writeFile(
    path.join(opts.lockfileDir, '.pnp.cjs'),
    loaderFile,
    'utf8'
  );
}

export function lockfileToPackageRegistry(
  lockfile: LockfileObject,
  opts: {
    importerNames: { [importerId: string]: string };
    lockfileDir: string;
    virtualStoreDir: string;
    virtualStoreDirMaxLength: number;
    registries: Registries;
  }
): PackageRegistry {
  const packageRegistry: PackageRegistry = new Map<
    string | null,
    PackageStore
  >();

  for (const [importerId, importer] of Object.entries(
    lockfile.importers ?? {}
  )) {
    if (importerId === '.') {
      const packageStore: PackageStore = new Map([
        [
          null,
          {
            packageDependencies: new Map([
              ...(importer.dependencies != null
                ? toPackageDependenciesMap(lockfile, importer.dependencies)
                : []),
              ...(importer.optionalDependencies != null
                ? toPackageDependenciesMap(
                    lockfile,
                    importer.optionalDependencies
                  )
                : []),
              ...(importer.devDependencies != null
                ? toPackageDependenciesMap(lockfile, importer.devDependencies)
                : []),
            ]),
            packageLocation: './' as PortablePath,
            packagePeers: new Set<string>(),
            linkType: LinkType.HARD,
            discardFromLookup: false,
          },
        ],
      ]);

      packageRegistry.set(null, packageStore);
    } else {
      const name = opts.importerNames[importerId];

      if (typeof name !== 'string') {
        continue;
      }

      const packageStore: PackageStore = new Map([
        [
          importerId,
          {
            packageDependencies: new Map([
              [name, importerId],
              ...(importer.dependencies != null
                ? toPackageDependenciesMap(
                    lockfile,
                    importer.dependencies,
                    importerId
                  )
                : []),
              ...(importer.optionalDependencies != null
                ? toPackageDependenciesMap(
                    lockfile,
                    importer.optionalDependencies,
                    importerId
                  )
                : []),
              ...(importer.devDependencies != null
                ? toPackageDependenciesMap(
                    lockfile,
                    importer.devDependencies,
                    importerId
                  )
                : []),
            ]),
            packageLocation: `./${importerId}` as PortablePath,
            packagePeers: new Set<string>(),
            linkType: LinkType.HARD,
            discardFromLookup: false,
          },
        ],
      ]);

      packageRegistry.set(name, packageStore);
    }
  }

  for (const [relDepPath, pkgSnapshot] of Object.entries(
    lockfile.packages ?? {}
  )) {
    const { name, version, peersSuffix } = nameVerFromPkgSnapshot(
      relDepPath,
      pkgSnapshot
    );

    const pnpVersion = toPnPVersion(version, peersSuffix);

    let packageStore = packageRegistry.get(name);

    if (typeof packageStore === 'undefined') {
      packageStore = new Map();
      packageRegistry.set(name, packageStore);
    }

    // Seems like this field should always contain a relative path
    let packageLocation: PortablePath = normalizePath(
      path.relative(
        opts.lockfileDir,
        path.join(
          opts.virtualStoreDir,
          depPathToFilename(relDepPath, opts.virtualStoreDirMaxLength),
          'node_modules',
          name
        )
      )
    ) as PortablePath;

    if (!packageLocation.startsWith('../')) {
      packageLocation = `./${packageLocation}` as PortablePath;
    }

    packageStore.set(pnpVersion, {
      packageDependencies: new Map([
        [name, pnpVersion],
        ...(pkgSnapshot.dependencies != null
          ? toPackageDependenciesMap(lockfile, pkgSnapshot.dependencies)
          : []),
        ...(pkgSnapshot.optionalDependencies != null
          ? toPackageDependenciesMap(lockfile, pkgSnapshot.optionalDependencies)
          : []),
      ]),
      packageLocation,
      packagePeers: new Set<string>(),
      linkType: LinkType.HARD,
      discardFromLookup: false,
    });
  }

  return packageRegistry;
}

function toPackageDependenciesMap(
  lockfile: LockfileObject,
  deps: {
    [depAlias: string]: string;
  },
  importerId?: string | undefined
): Array<[string, string | [string, string]]> {
  return Object.entries(deps).map(([depAlias, ref]) => {
    if (typeof importerId === 'string' && ref.startsWith('link:')) {
      return [depAlias, path.join(importerId, ref.slice(5))];
    }

    const relDepPath = refToRelative(ref, depAlias);

    if (!relDepPath) {
      return [depAlias, ref];
    }

    const { name, version, peersSuffix } = nameVerFromPkgSnapshot(
      relDepPath,
      lockfile.packages?.[relDepPath]
    );

    const pnpVersion = toPnPVersion(version, peersSuffix);

    if (depAlias === name) {
      return [depAlias, pnpVersion];
    }

    return [depAlias, [name, pnpVersion]];
  });
}

function toPnPVersion(
  version: string,
  peersSuffix: string | undefined
): string {
  return typeof peersSuffix === 'string'
    ? `virtual:${version}${peersSuffix}#${version}`
    : version;
}
