import path from 'node:path';
import getNpmTarballUrl from 'get-npm-tarball-url';
import { OspmError } from '../error/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import { readModulesDir } from '../read-modules-dir/index.ts';
import rimraf from '@zkochan/rimraf';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import type {
  PackageResponse,
  StoreController,
} from '../package-store/index.ts';
import type {
  GlobalPkgDir,
  LockFileDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  Registries,
  WorkspaceDir,
} from '../types/index.ts';

export async function installConfigDeps<IP>(
  configDeps: Record<string, string>,
  opts: {
    registries: Registries;
    rootDir:
      | ProjectRootDir
      | ProjectRootDirRealPath
      | GlobalPkgDir
      | WorkspaceDir
      | LockFileDir;
    store: StoreController<PackageResponse, PackageResponse, IP>;
  }
): Promise<void> {
  const configModulesDir = path.join(opts.rootDir, 'node_modules/.ospm-config');

  const existingConfigDeps: string[] =
    (await readModulesDir(configModulesDir)) ?? [];

  await Promise.all(
    existingConfigDeps.map(async (existingConfigDep) => {
      if (typeof configDeps[existingConfigDep] === 'undefined') {
        await rimraf(path.join(configModulesDir, existingConfigDep));
      }
    })
  );

  await Promise.all(
    Object.entries(configDeps).map(
      async ([pkgName, pkgSpec]: [string, string]): Promise<void> => {
        const configDepPath = path.join(configModulesDir, pkgName);

        const sepIndex = pkgSpec.indexOf('+');

        if (sepIndex === -1) {
          throw new OspmError(
            'CONFIG_DEP_NO_INTEGRITY',
            `Your config dependency called "${pkgName}" at "ospm.configDependencies" doesn't have an integrity checksum`,
            {
              hint: `
                All config dependencies should have their integrity checksum inlined in the version specifier. For example:

                {
                  "ospm": {
                    "configDependencies": {
                      "my-config": "1.0.0+sha512-Xg0tn4HcfTijTwfDwYlvVCl43V6h4KyVVX2aEm4qdO/PC6L2YvzLHFdmxhoeSA3eslcE6+ZVXHgWwopXYLNq4Q=="
                    },
                  }
                }
              `,
            }
          );
        }

        const version = pkgSpec.substring(0, sepIndex);

        const integrity = pkgSpec.substring(sepIndex + 1);

        if (existingConfigDeps.includes(pkgName)) {
          const configDepPkgJson =
            await safeReadPackageJsonFromDir(configDepPath);

          if (
            configDepPkgJson == null ||
            configDepPkgJson.name !== pkgName ||
            configDepPkgJson.version !== version
          ) {
            await rimraf(configDepPath);
          }
        }

        const registry = pickRegistryForPackage(opts.registries, pkgName);

        const { fetching } = await opts.store.fetchPackage({
          force: true,
          lockfileDir: opts.rootDir,
          pkg: {
            id: `${pkgName}@${version}`,
            resolution: {
              tarball: getNpmTarballUrl(pkgName, version, { registry }),
              integrity,
            },
          },
        });

        if (typeof fetching === 'function') {
          const { files: filesResponse } = await fetching();

          await opts.store.importPackage(configDepPath, {
            force: true,
            requiresBuild: false,
            filesResponse,
          });
        }
      }
    )
  );
}
