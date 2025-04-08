import type { Config } from '../config/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import type { ParseWantedDependencyResult } from '../parse-wanted-dependency/index.ts';
import type { LockFileDir } from '../types/index.ts';

export type WritePackageOptions = CreateStoreControllerOptions &
  Pick<Config, 'registries'>;

export async function writePackage(
  dep: ParseWantedDependencyResult,
  dest: string,
  opts: WritePackageOptions
): Promise<void> {
  const store = await createOrConnectStoreController({
    ...opts,
    packageImportMethod: 'clone-or-copy',
  });

  const pkgResponse = await store.ctrl.requestPackage(dep, {
    downloadPriority: 1,
    lockfileDir: opts.dir as LockFileDir,
    preferredVersions: {},
    projectDir: opts.dir,
    registry:
      (typeof dep.alias === 'string' &&
        pickRegistryForPackage(opts.registries, dep.alias)) ||
      opts.registries.default,
  });

  const response = await pkgResponse.fetching?.();

  if (typeof response !== 'undefined') {
    const { files } = response;

    await store.ctrl.importPackage(dest, {
      filesResponse: files,
      force: true,
    });
  }
}
