import {
  docsUrl,
  readDepNameCompletions,
  readProjectManifest,
} from '../cli-utils/index.ts';
import type { CompletionFunc } from '../command/index.ts';
import {
  FILTERING,
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import type { Config } from '../config/index.ts';
import {
  types as allTypes,
} from '../config/types.ts';
import { OspmError } from '../error/index.ts';
import { arrayOfWorkspacePackagesToMap } from '../get-context/index.ts';
import { findWorkspacePackages } from '../workspace.find-packages/index.ts';
import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type { DependenciesField } from '../types/index.ts';
import { mutateModulesInSingleProject } from '../core/install/index.ts';
import { requireHooks } from '../pnpmfile/index.ts';
import pick from 'ramda/src/pick';
import without from 'ramda/src/without';
import renderHelp from 'render-help';
import { getSaveType } from './getSaveType.ts';
import { recursive } from './recursive.ts';
import { installConfigDeps } from './installConfigDeps.ts';
import { getOptionsFromRootManifest } from '../config/getOptionsFromRootManifest.ts';

class RemoveMissingDepsError extends OspmError {
  constructor(opts: {
    availableDependencies: string[];
    nonMatchedDependencies: string[];
    targetDependenciesField?: DependenciesField | undefined;
  }) {
    let message = 'Cannot remove ';

    message += `${opts.nonMatchedDependencies.map((dep) => `'${dep}'`).join(', ')}: `;

    if (opts.availableDependencies.length > 0) {
      message += `no such ${opts.nonMatchedDependencies.length > 1 ? 'dependencies' : 'dependency'} `;
      message += `found${opts.targetDependenciesField ? ` in '${opts.targetDependenciesField}'` : ''}`;
      const hint = `Available dependencies: ${opts.availableDependencies.join(', ')}`;
      super('CANNOT_REMOVE_MISSING_DEPS', message, { hint });
      return;
    }

    message += opts.targetDependenciesField
      ? `project has no '${opts.targetDependenciesField}'`
      : 'project has no dependencies of any kind';

    super('CANNOT_REMOVE_MISSING_DEPS', message);
  }
}

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default(
    [
      'cache-dir',
      'global-dir',
      'global-ospmfile',
      'global',
      'lockfile-dir',
      'lockfile-directory',
      'lockfile-only',
      'lockfile',
      'node-linker',
      'package-import-method',
      'ospmfile',
      'reporter',
      'save-dev',
      'save-optional',
      'save-prod',
      'shared-workspace-lockfile',
      'store-dir',
      'strict-peer-dependencies',
      'virtual-store-dir',
    ],
    allTypes
  );
}

export const cliOptionsTypes = (): Record<string, unknown> => {
  return {
    ...rcOptionsTypes(),
    ...pick.default(['force'], allTypes),
    recursive: Boolean,
  };
};

export function help(): string {
  return renderHelp({
    aliases: ['rm', 'uninstall', 'un'],
    description:
      "Removes packages from `node_modules` and from the project's `package.json`.",
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Remove from every package found in subdirectories \
or from every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "ospm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description: 'Remove the dependency only from "devDependencies"',
            name: '--save-dev',
            shortAlias: '-D',
          },
          {
            description:
              'Remove the dependency only from "optionalDependencies"',
            name: '--save-optional',
            shortAlias: '-O',
          },
          {
            description: 'Remove the dependency only from "dependencies"',
            name: '--save-prod',
            shortAlias: '-P',
          },
          OPTIONS.globalDir,
          ...UNIVERSAL_OPTIONS,
        ],
      },
      FILTERING,
    ],
    url: docsUrl('remove'),
    usages: ['ospm remove <pkg>[@<version>]...'],
  });
}

// Unlike npm, ospm does not treat "r" as an alias of "remove".
// This way we avoid the confusion about whether "ospm r" means remove, run, or recursive.
export const commandNames = ['remove', 'uninstall', 'rm', 'un', 'uni'];

export const completion: CompletionFunc = async (
  cliOpts: Record<string, unknown>
): Promise<
  {
    name: string;
  }[]
> => {
  return readDepNameCompletions(cliOpts.dir as string);
};

export async function handler(
  opts: CreateStoreControllerOptions &
    Pick<
      Config,
      | 'allProjects'
      | 'allProjectsGraph'
      | 'bail'
      | 'bin'
      | 'configDependencies'
      | 'dev'
      | 'engineStrict'
      | 'globalOspmfile'
      | 'hooks'
      | 'ignoreOspmfile'
      | 'linkWorkspacePackages'
      | 'lockfileDir'
      | 'optional'
      | 'ospmfile'
      | 'production'
      | 'rawLocalConfig'
      | 'registries'
      | 'rootProjectManifest'
      | 'rootProjectManifestDir'
      | 'saveDev'
      | 'saveOptional'
      | 'saveProd'
      | 'selectedProjectsGraph'
      | 'workspaceDir'
      | 'workspacePackagePatterns'
      | 'sharedWorkspaceLockfile'
    > & {
      recursive?: boolean | undefined;
    },
  params: string[]
): Promise<void> {
  if (params.length === 0) {
    throw new OspmError(
      'MUST_REMOVE_SOMETHING',
      'At least one dependency name should be specified for removal'
    );
  }

  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  let store = await createOrConnectStoreController(opts);

  if (opts.configDependencies) {
    await installConfigDeps(opts.configDependencies, {
      registries: opts.registries,
      rootDir: opts.lockfileDir, // ?? opts.rootProjectManifestDir,
      store: store.ctrl,
    });
  }

  if (opts.ignoreOspmfile !== true) {
    opts.hooks = requireHooks(opts.lockfileDir, opts); //  ?? opts.dir

    if (opts.hooks.fetchers != null || opts.hooks.importPackage != null) {
      store = await createOrConnectStoreController(opts);
    }
  }

  if (
    opts.recursive === true &&
    opts.allProjects != null &&
    opts.selectedProjectsGraph != null &&
    typeof opts.workspaceDir === 'string'
  ) {
    await recursive(
      opts.allProjects,
      params,
      {
        ...opts,
        allProjectsGraph: opts.allProjectsGraph,
        include,
        selectedProjectsGraph: opts.selectedProjectsGraph,
        storeControllerAndDir: store,
        workspaceDir: opts.workspaceDir,
      },
      'remove'
    );
    return;
  }

  const removeOpts = Object.assign(opts, {
    ...getOptionsFromRootManifest(
      opts.rootProjectManifestDir,
      opts.rootProjectManifest
    ),
    linkWorkspacePackagesDepth:
      opts.linkWorkspacePackages === 'deep'
        ? Number.POSITIVE_INFINITY
        : opts.linkWorkspacePackages
          ? 0
          : -1,
    storeController: store.ctrl,
    storeDir: store.dir,
    include,
    update: false,
    engineStrict: false,
    force: false,
    lockfileDir: '',
    nodeVersion: '',
    ospmfile: '',
    rawLocalConfig: false,
    registry: '',
    rootProjectManifest: undefined,
    rootProjectManifestDir: '',
    ignoreScripts: false,
    savePeer: false,
    saveOptional: opts.saveOptional ?? false,
    saveProd: opts.saveProd ?? false,
    saveDev: opts.saveDev ?? false,
    saveExact: false,
    hooks: {},
    resolutionMode: 'workspace',
    unsafePerm: false,
    userAgent: '',
    resolveSymlinksInInjectedDirs: false,
    ignoreOspmfile: false,
    allowedDeprecatedVersions: {},
    packageExtensions: {},
    packageManager: { name: '', version: '' },
    peerDependencyRules: 'ignore',
    preferConcurrentVersions: false,
    preferWorkspaceProtocol: false,
    rawConfig: {},
    ignoredOptionalDependencies: [],
    allowNonAppliedPatches: false,
    overrides: {},
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  removeOpts.workspacePackages =
    typeof opts.workspaceDir === 'string'
      ? arrayOfWorkspacePackagesToMap(
          await findWorkspacePackages(opts.workspaceDir, {
            ...opts,
            patterns: opts.workspacePackagePatterns,
          })
        )
      : undefined;

  const targetDependenciesField = getSaveType({
    ...opts,
    savePeer: false,
    saveDev: opts.saveDev ?? false,
    saveOptional: opts.saveOptional ?? false,
    saveProd: opts.saveProd ?? false,
  });

  const { manifest: currentManifest, writeProjectManifest } =
    await readProjectManifest(opts.dir, opts);

  const availableDependencies = Object.keys(
    targetDependenciesField === undefined
      ? getAllDependenciesFromManifest(currentManifest)
      : (currentManifest[targetDependenciesField] ?? {})
  );

  const nonMatchedDependencies = without.default(availableDependencies, params);

  if (nonMatchedDependencies.length !== 0) {
    throw new RemoveMissingDepsError({
      availableDependencies,
      nonMatchedDependencies,
      targetDependenciesField,
    });
  }

  const mutationResult = await mutateModulesInSingleProject(
    {
      binsDir: opts.bin,
      dependencyNames: params,
      manifest: currentManifest,
      mutation: 'uninstallSome',
      rootDir: opts.dir,
      targetDependenciesField,
    },
    removeOpts
  );

  const m = mutationResult.updatedProject?.manifest;

  if (typeof m === 'undefined') {
    console.warn('No manifest to write');

    return;
  }

  await writeProjectManifest(m);
}
