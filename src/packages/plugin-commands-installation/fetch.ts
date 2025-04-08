import { docsUrl } from '../cli-utils/index.ts';
import { UNIVERSAL_OPTIONS } from '../common-cli-options-help/index.ts';
import { type Config, getOptionsFromRootManifest } from '../config/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type { LockFileDir, ProjectRootDir } from '../types/index.ts';
import renderHelp from 'render-help';
import { cliOptionsTypes } from './install.ts';
import { mutateModulesInSingleProject } from '../core/install/index.ts';
import path from 'node:path';

export const rcOptionsTypes = cliOptionsTypes;

export { cliOptionsTypes };

export const shorthands: Record<string, string> = {
  D: '--dev',
  P: '--production',
};

export const commandNames = ['fetch'];

export function help(): string {
  return renderHelp({
    description:
      'Fetch packages from a lockfile into virtual store, package manifest is ignored. WARNING! This is an experimental command. Breaking changes may be introduced in non-major versions of the CLI',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description: 'Only development packages will be fetched',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description: 'Development packages will not be fetched',
            name: '--prod',
            shortAlias: '-P',
          },
          ...UNIVERSAL_OPTIONS,
        ],
      },
    ],
    url: docsUrl('fetch'),
    usages: ['pnpm fetch [--dev | --prod]'],
  });
}

type FetchCommandOptions = Pick<
  Config,
  'production' | 'dev' | 'rootProjectManifest' | 'rootProjectManifestDir'
> &
  CreateStoreControllerOptions;

export async function handler(opts: FetchCommandOptions): Promise<void> {
  const store = await createOrConnectStoreController(opts);

  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    // when including optional deps, production is also required when perform headless install
    optionalDependencies: opts.production !== false,
  };

  await mutateModulesInSingleProject(
    {
      binsDir: path.join('node_modules', '.bin'),
      manifest: { name: '', version: '' },
      update: false,
      mutation: 'install',
      pruneDirectDependencies: true,
      rootDir: process.cwd() as ProjectRootDir,
    },
    {
      bin: path.join('node_modules', '.bin'),
      lockfileDir: '' as LockFileDir,
      update: false,
      ...opts,
      ...getOptionsFromRootManifest(
        opts.rootProjectManifestDir,
        opts.rootProjectManifest
      ),
      ignoreScripts: opts.ignoreScripts ?? false,
      nodeVersion: opts.nodeVersion ?? 'latest',
      force: opts.force ?? false,
      engineStrict: opts.engineStrict ?? false,
      ignorePackageManifest: true,
      include,
      modulesCacheMaxAge: 0,
      pruneStore: true,
      storeController: store.ctrl,
      storeDir: store.dir,
      userAgent: opts.userAgent ?? '',
      packageExtensions: {},
      hooks: {},
      unsafePerm: opts.unsafePerm ?? false,
      allowNonAppliedPatches: false,
      resolutionMode: opts.resolutionMode ?? 'highest',
      ignoredOptionalDependencies: [],
      resolveSymlinksInInjectedDirs:
        opts.resolveSymlinksInInjectedDirs ?? false,
      overrides: {},
      allowedDeprecatedVersions: {},
    }
  );
}
