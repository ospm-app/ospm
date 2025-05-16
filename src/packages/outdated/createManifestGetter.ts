import {
  createResolver,
  type ClientOptions,
  type ResolveFunction,
} from '../client/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import type {
  DependencyManifest,
  LockFileDir,
  Registries,
} from '../types/index.ts';

type GetManifestOpts = {
  dir: string;
  lockfileDir: LockFileDir;
  rawConfig: Record<string, string>;
  registries: Registries;
};

export type ManifestGetterOptions = Omit<ClientOptions, 'authConfig'> &
  GetManifestOpts & {
    fullMetadata: boolean;
    rawConfig: Record<string, string>;
  };

export function createManifestGetter(
  opts: ManifestGetterOptions
): (packageName: string, pref: string) => Promise<DependencyManifest | null> {
  const { resolve } = createResolver({
    ...opts,
    authConfig: opts.rawConfig,
  });

  return getManifest.bind(null, resolve, opts);
}

export async function getManifest(
  resolve: ResolveFunction,
  opts: GetManifestOpts,
  packageName: string,
  pref: string
): Promise<DependencyManifest | null> {
  const resolution = await resolve(
    { alias: packageName, pref },
    {
      lockfileDir: opts.lockfileDir,
      preferredVersions: {},
      projectDir: opts.dir,
      registry: pickRegistryForPackage(opts.registries, packageName, pref),
    }
  );

  return resolution.manifest ?? null;
}
