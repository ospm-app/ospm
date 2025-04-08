import { docsUrl, readProjectManifestOnly } from '../cli-utils/index.ts';
import {
  FILTERING,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { type Config, types as allTypes } from '../config/index.ts';
import {
  createOrConnectStoreController,
  type CreateStoreControllerOptions,
} from '../store-connection-manager/index.ts';
import type { ModulesDir, ProjectId, ProjectRootDir } from '../types/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import {
  rebuildProjects,
  rebuildSelectedPkgs,
} from './implementation/index.ts';
import { recursiveRebuild } from './recursive.ts';
import type { ReporterFunction } from '../headless/index.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(
      [
        'npm-path',
        'reporter',
        'scripts-prepend-node-path',
        'unsafe-perm',
        'store-dir',
      ],
      allTypes
    ),
  };
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
    pending: Boolean,
    recursive: Boolean,
  };
}

export const commandNames = ['rebuild', 'rb'];

export function help(): string {
  return renderHelp({
    aliases: ['rb'],
    description: 'Rebuild a package.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Rebuild every package found in subdirectories \
or every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "pnpm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description:
              'Rebuild packages that were not build during installation. Packages are not build when installing with the --ignore-scripts flag',
            name: '--pending',
          },
          {
            description:
              'The directory in which all the packages are saved on the disk',
            name: '--store-dir <dir>',
          },
          ...UNIVERSAL_OPTIONS,
        ],
      },
      FILTERING,
    ],
    url: docsUrl('rebuild'),
    usages: ['pnpm rebuild [<pkg> ...]'],
  });
}

export type RebuildCommandOpts = Pick<
  Config,
  | 'allProjects'
  | 'dir'
  | 'engineStrict'
  | 'hooks'
  | 'lockfileDir'
  | 'nodeLinker'
  | 'rawLocalConfig'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
  | 'registries'
  | 'scriptShell'
  | 'selectedProjectsGraph'
  | 'sideEffectsCache'
  | 'sideEffectsCacheReadonly'
  | 'scriptsPrependNodePath'
  | 'shellEmulator'
  | 'workspaceDir'
> &
  CreateStoreControllerOptions & {
    recursive?: boolean | undefined;
    reporter?: ReporterFunction | undefined;
    pending: boolean;
    skipIfHasSideEffectsCache?: boolean | undefined;
    neverBuiltDependencies?: string[] | undefined;
    onlyBuiltDependencies?: string[] | undefined;
  };

export async function handler(
  opts: RebuildCommandOpts,
  params: string[]
): Promise<void> {
  if (
    opts.recursive === true &&
    opts.allProjects != null &&
    opts.selectedProjectsGraph != null &&
    typeof opts.workspaceDir === 'string' &&
    opts.workspaceDir !== ''
  ) {
    await recursiveRebuild(opts.allProjects, params, {
      ...opts,
      selectedProjectsGraph: opts.selectedProjectsGraph,
      workspaceDir: opts.workspaceDir,
    });

    return;
  }

  const store = await createOrConnectStoreController(opts);

  const rebuildOpts = Object.assign(opts, {
    sideEffectsCacheRead:
      opts.sideEffectsCache ?? opts.sideEffectsCacheReadonly,
    sideEffectsCacheWrite: opts.sideEffectsCache,
    storeController: store.ctrl,
    storeDir: store.dir,
  });

  if (params.length === 0) {
    await rebuildProjects(
      [
        {
          // TODO: fix id
          id: '' as ProjectId,
          // TODO: fix binsDir
          binsDir: '' as ProjectRootDir,
          // TODO: fix modulesDir
          modulesDir: 'node_modules' as ModulesDir,
          // TODO: fix buildIndex
          buildIndex: 0,
          manifest: await readProjectManifestOnly(rebuildOpts.dir, opts),
          rootDir: rebuildOpts.dir as ProjectRootDir,
        },
      ],
      rebuildOpts
    );
    return;
  }

  await rebuildSelectedPkgs(
    [
      {
        // TODO: fix id
        id: '' as ProjectId,
        // TODO: fix binsDir
        binsDir: '' as ProjectRootDir,
        // TODO: fix modulesDir
        modulesDir: 'node_modules' as ModulesDir,
        // TODO: fix buildIndex
        buildIndex: 0,
        manifest: await readProjectManifestOnly(rebuildOpts.dir, opts),
        rootDir: rebuildOpts.dir as ProjectRootDir,
      },
    ],
    params,
    rebuildOpts
  );
}
