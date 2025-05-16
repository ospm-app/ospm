import path from 'node:path';
import {
  type CatalogResolver,
  resolveFromCatalog,
} from '../catalogs.resolver/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';
import { OspmError } from '../error/index.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import type { Dependencies, ProjectManifest } from '../types/index.ts';
import omit from 'ramda/src/omit';
import pMapValues from 'p-map-values';
import { overridePublishConfig } from './overridePublishConfig.ts';

const PREPUBLISH_SCRIPTS = [
  'prepublishOnly',
  'prepack',
  'prepare',
  'postpack',
  'publish',
  'postpublish',
];

export type MakePublishManifestOptions = {
  catalogs: Catalogs;
  modulesDir?: string | undefined;
  readmeFile?: string | undefined;
};

export async function createExportableManifest(
  dir: string,
  originalManifest: ProjectManifest,
  opts: MakePublishManifestOptions
): Promise<ProjectManifest> {
  const publishManifest: ProjectManifest = omit.default(
    ['ospm', 'scripts', 'packageManager'],
    originalManifest
  );

  if (originalManifest.scripts != null) {
    publishManifest.scripts = omit.default(
      PREPUBLISH_SCRIPTS,
      originalManifest.scripts
    );
  }

  const catalogResolver = resolveFromCatalog.bind(null, opts.catalogs);

  const replaceCatalogProtocol = resolveCatalogProtocol.bind(
    null,
    catalogResolver
  );

  const convertDependencyForPublish = combineConverters(
    replaceWorkspaceProtocol,
    replaceCatalogProtocol
  );

  await Promise.all(
    (['dependencies', 'devDependencies', 'optionalDependencies'] as const).map(
      async (
        depsField: 'dependencies' | 'devDependencies' | 'optionalDependencies'
      ) => {
        const deps = await makePublishDependencies(
          dir,
          originalManifest[depsField],
          {
            modulesDir: opts.modulesDir ?? 'node_modules',
            convertDependencyForPublish,
          }
        );

        if (deps != null) {
          publishManifest[depsField] = deps;
        }
      }
    )
  );

  const peerDependencies = originalManifest.peerDependencies;

  if (typeof peerDependencies !== 'undefined') {
    const convertPeersForPublish = combineConverters(
      replaceWorkspaceProtocolPeerDependency,
      replaceCatalogProtocol
    );

    publishManifest.peerDependencies = await makePublishDependencies(
      dir,
      peerDependencies,
      {
        modulesDir: opts.modulesDir ?? 'node_modules',
        convertDependencyForPublish: convertPeersForPublish,
      }
    );
  }

  overridePublishConfig(publishManifest);

  if (typeof opts.readmeFile === 'string') {
    publishManifest.readme ??= opts.readmeFile;
  }

  return publishManifest;
}

export type PublishDependencyConverter = (
  depName: string,
  depSpec: string,
  dir: string,
  modulesDir?: string | undefined
) => Promise<string> | string;

function combineConverters(
  ...converters: readonly PublishDependencyConverter[]
): PublishDependencyConverter {
  return async (
    depName: string,
    depSpec: string,
    dir: string,
    modulesDir?: string | undefined
  ) => {
    let pref = depSpec;

    for (const converter of converters) {
      pref = await converter(depName, pref, dir, modulesDir);
    }

    return pref;
  };
}

export interface MakePublishDependenciesOpts {
  readonly modulesDir?: string | undefined;
  readonly convertDependencyForPublish: PublishDependencyConverter;
}

async function makePublishDependencies(
  dir: string,
  dependencies: Dependencies | undefined,
  { modulesDir, convertDependencyForPublish }: MakePublishDependenciesOpts
): Promise<Dependencies | undefined> {
  if (dependencies == null) {
    return dependencies;
  }

  return await pMapValues.default(
    async (depSpec: string, depName: string): Promise<string> => {
      return convertDependencyForPublish(depName, depSpec, dir, modulesDir);
    },
    dependencies
  );
}

async function readAndCheckManifest(
  depName: string,
  dependencyDir: string
): Promise<ProjectManifest> {
  const { manifest } = await tryReadProjectManifest(dependencyDir);

  if (typeof manifest?.name === 'undefined' || !manifest.version) {
    throw new OspmError(
      'CANNOT_RESOLVE_WORKSPACE_PROTOCOL',
      `Cannot resolve workspace protocol of dependency "${depName}" because this dependency is not installed. Try running "ospm install".`
    );
  }

  return manifest;
}

function resolveCatalogProtocol(
  catalogResolver: CatalogResolver,
  alias: string,
  pref: string
): string {
  const result = catalogResolver({ alias, pref });

  switch (result.type) {
    case 'found': {
      return result.resolution.specifier;
    }
    case 'unused': {
      return pref;
    }
    case 'misconfiguration': {
      throw result.error;
    }
  }
}

async function replaceWorkspaceProtocol(
  depName: string,
  depSpec: string,
  dir: string,
  modulesDir?: string | undefined
): Promise<string> {
  if (!depSpec.startsWith('workspace:')) {
    return depSpec;
  }

  // Dependencies with bare "*", "^" and "~" versions
  const versionAliasSpecParts = /^workspace:(.*?)@?([*^~])$/.exec(depSpec);

  if (versionAliasSpecParts != null) {
    const newModulesDir = modulesDir ?? path.join(dir, 'node_modules');

    const manifest = await readAndCheckManifest(
      depName,
      path.join(newModulesDir, depName)
    );

    const semverRangeToken =
      versionAliasSpecParts[2] === '*' ? '' : versionAliasSpecParts[2];

    if (depName !== manifest.name) {
      return `npm:${manifest.name}@${semverRangeToken}${manifest.version}`;
    }

    return `${semverRangeToken}${manifest.version}`;
  }
  if (
    depSpec.startsWith('workspace:./') ||
    depSpec.startsWith('workspace:../')
  ) {
    const manifest = await readAndCheckManifest(
      depName,
      path.join(dir, depSpec.slice(10))
    );

    if (manifest.name === depName) return `${manifest.version}`;

    return `npm:${manifest.name}@${manifest.version}`;
  }

  const newDepSpec = depSpec.slice(10);

  if (newDepSpec.includes('@')) {
    return `npm:${newDepSpec}`;
  }

  return newDepSpec;
}

async function replaceWorkspaceProtocolPeerDependency(
  depName: string,
  depSpec: string,
  dir: string,
  modulesDir?: string | undefined
): Promise<string> {
  if (depSpec.includes('workspace:') !== true) {
    return depSpec;
  }

  // Dependencies with bare "*", "^", "~",">=",">","<=", "<", version
  const workspaceSemverRegex =
    /workspace:([*^~]|>=|>|<=|<)?((\d+|[*Xx])(\.(\d+|[*Xx])){0,2})?/;

  const versionAliasSpecParts = workspaceSemverRegex.exec(depSpec);

  if (versionAliasSpecParts != null) {
    const [_, semverRangGroup = '', version] = versionAliasSpecParts;

    if (typeof version === 'string') {
      return depSpec.replace('workspace:', '');
    }

    const manifest = await readAndCheckManifest(
      depName,
      path.join(modulesDir ?? path.join(dir, 'node_modules'), depName)
    );

    return depSpec.replace(
      workspaceSemverRegex,
      `${semverRangGroup === '*' ? '' : semverRangGroup}${manifest.version}`
    );
  }

  return depSpec.replace('workspace:', '');
}
