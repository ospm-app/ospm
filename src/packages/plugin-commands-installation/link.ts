import path from 'node:path';
import {
  docsUrl,
  tryReadProjectManifest,
  type ReadProjectManifestOpts,
} from '../cli-utils/index.ts';
import { UNIVERSAL_OPTIONS } from '../common-cli-options-help/index.ts';
import type { Config } from '../config/index.ts';
import { types as allTypes } from '../config/types.ts';
import {
  DEPENDENCIES_FIELDS,
  type ProjectManifest,
  type Project,
} from '../types/index.ts';
import { OspmError } from '../error/index.ts';
import { arrayOfWorkspacePackagesToMap } from '../get-context/index.ts';
import { findWorkspacePackages } from '../workspace.find-packages/index.ts';
import type { WorkspacePackages } from '../core/index.ts';
import { logger } from '../logger/index.ts';
import pick from 'ramda/src/pick';
import partition from 'ramda/src/partition';
import renderHelp from 'render-help';
import { createProjectManifestWriter } from './createProjectManifestWriter.ts';
import { getSaveType } from './getSaveType.ts';
import * as install from './install.ts';
import normalize from 'normalize-path';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const isWindows = process.platform === 'win32' || global.FAKE_WINDOWS;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
const isFilespec = isWindows
  ? /^(?:[./\\]|~\/|[a-z]:)/i
  : /^(?:[./]|~\/|[a-z]:)/i;

type LinkOpts = Pick<
  Config,
  | 'bin'
  | 'cliOptions'
  | 'engineStrict'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
  | 'saveDev'
  | 'saveOptional'
  | 'saveProd'
  | 'workspaceDir'
  | 'workspacePackagePatterns'
  | 'sharedWorkspaceLockfile'
  | 'globalPkgDir'
> &
  Partial<Pick<Config, 'linkWorkspacePackages'>> &
  install.InstallCommandOptions;

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return pick.default(
    [
      'global-dir',
      'global',
      'only',
      'package-import-method',
      'production',
      'registry',
      'reporter',
      'save-dev',
      'save-exact',
      'save-optional',
      'save-prefix',
      'unsafe-perm',
    ],
    allTypes
  );
}

export const commandNames = ['link', 'ln'];

export function help(): string {
  return renderHelp({
    aliases: ['ln'],
    descriptionLists: [
      {
        title: 'Options',

        list: UNIVERSAL_OPTIONS,
      },
    ],
    url: docsUrl('link'),
    usages: ['ospm link <dir|pkg name>', 'ospm link'],
  });
}

async function checkPeerDeps(
  linkCwdDir: string,
  opts: LinkOpts
): Promise<void> {
  const { manifest } = await tryReadProjectManifest(linkCwdDir, opts);

  if (
    manifest?.peerDependencies &&
    Object.keys(manifest.peerDependencies).length > 0
  ) {
    const packageName = manifest.name || path.basename(linkCwdDir); // Assuming the name property exists in newManifest
    const peerDeps = Object.entries(manifest.peerDependencies)
      .map(([key, value]) => `  - ${key}@${String(value)}`)
      .join(', ');

    logger.warn({
      message: `The package ${packageName}, which you have just ospm linked, has the following peerDependencies specified in its package.json:

${peerDeps}

The linked in dependency will not resolve the peer dependencies from the target node_modules.
This might cause issues in your project. To resolve this, you may use the "file:" protocol to reference the local dependency.`,
      prefix: opts.dir,
    });
  }
}

export async function handler(
  opts: LinkOpts,
  params?: string[]
): Promise<void> {
  let workspacePackagesArr: Project[];

  let workspacePackages!: WorkspacePackages;

  if (typeof opts.workspaceDir === 'string') {
    workspacePackagesArr = await findWorkspacePackages(opts.workspaceDir, {
      ...opts,
      patterns: opts.workspacePackagePatterns,
    });

    workspacePackages = arrayOfWorkspacePackagesToMap(workspacePackagesArr);
  } else {
    workspacePackages = new Map();
  }

  const linkOpts = Object.assign(opts, {
    targetDependenciesField: getSaveType(opts),
    workspacePackages,
    binsDir: opts.bin,
  });

  if (opts.cliOptions.global === true && opts.bin === '') {
    throw new OspmError(
      'NO_GLOBAL_BIN_DIR',
      'Unable to find the global bin directory',
      {
        hint: 'Run "ospm setup" to create it automatically, or set the global-bin-dir setting, or the OSPM_HOME env variable. The global bin directory should be in the PATH.',
      }
    );
  }

  const writeProjectManifest = await createProjectManifestWriter(
    opts.rootProjectManifestDir
  );

  // ospm link
  if (params == null || params.length === 0) {
    const cwd = process.cwd();
    if (path.relative(linkOpts.dir, cwd) === '') {
      throw new OspmError('LINK_BAD_PARAMS', 'You must provide a parameter');
    }

    await checkPeerDeps(cwd, opts);

    if (typeof opts.rootProjectManifest !== 'undefined') {
      await addLinkToManifest(
        opts,
        opts.rootProjectManifest,
        cwd,
        opts.rootProjectManifestDir
      );

      await writeProjectManifest(opts.rootProjectManifest);
    }

    await install.handler({
      ...linkOpts,
      frozenLockfileIfExists: false,
      rootProjectManifest: opts.rootProjectManifest,
    });

    return;
  }

  const [pkgPaths, pkgNames] = partition.default((inp: string): boolean => {
    return isFilespec.test(inp);
  }, params);

  for (const pkgName of pkgNames) {
    pkgPaths.push(path.join(opts.globalPkgDir, 'node_modules', pkgName));
  }

  if (typeof opts.rootProjectManifest !== 'undefined') {
    await Promise.all(
      pkgPaths.map(async (dir: string): Promise<void> => {
        if (typeof opts.rootProjectManifest !== 'undefined') {
          await addLinkToManifest(
            opts,
            opts.rootProjectManifest,
            dir,
            opts.rootProjectManifestDir
          );
        }

        await checkPeerDeps(dir, opts);
      })
    );

    await writeProjectManifest(opts.rootProjectManifest);
  }

  await install.handler({
    ...linkOpts,
    frozenLockfileIfExists: false,
    rootProjectManifest: opts.rootProjectManifest,
  });
}

async function addLinkToManifest(
  opts: ReadProjectManifestOpts,
  manifest: ProjectManifest,
  linkedDepDir: string,
  manifestDir: string
): Promise<void> {
  if (typeof manifest.ospm === 'undefined') {
    manifest.ospm = {
      overrides: {},
    };
  }

  if (typeof manifest.ospm.overrides === 'undefined') {
    manifest.ospm.overrides = {};
  }

  const { manifest: linkedManifest } = await tryReadProjectManifest(
    linkedDepDir,
    opts
  );

  const linkedPkgName = linkedManifest?.name ?? path.basename(linkedDepDir);

  const linkedPkgSpec = `link:${normalize(path.relative(manifestDir, linkedDepDir))}`;

  manifest.ospm.overrides[linkedPkgName] = linkedPkgSpec;

  if (
    DEPENDENCIES_FIELDS.every(
      (depField) => manifest[depField]?.[linkedPkgName] == null
    )
  ) {
    manifest.dependencies = manifest.dependencies ?? {};
    manifest.dependencies[linkedPkgName] = linkedPkgSpec;
  }
}
