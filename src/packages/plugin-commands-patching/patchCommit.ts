import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { docsUrl } from '../cli-utils/index.ts';
import { type Config, types as allTypes } from '../config/index.ts';
import { createShortHash } from '../crypto.hash/index.ts';
import { PnpmError } from '../error/index.ts';
import { packlist } from '../fs.packlist/index.ts';
import { globalWarn } from '../logger/index.ts';
import { install } from '../plugin-commands-installation/index.ts';
import { readPackageJsonFromDir } from '../read-package-json/index.ts';
import { tryReadProjectManifest } from '../read-project-manifest/index.ts';
import { getStorePath } from '../store-path/index.ts';
import type { ProjectManifest, ProjectRootDir } from '../types/index.ts';
import { glob } from 'tinyglobby';
import normalizePath from 'normalize-path';
import pick from 'ramda/src/pick';
import equals from 'ramda/src/equals';
import execa from 'safe-execa';
import escapeStringRegexp from 'escape-string-regexp';
import makeEmptyDir from 'make-empty-dir';
import renderHelp from 'render-help';
import { type WritePackageOptions, writePackage } from './writePackage.ts';
import {
  type ParseWantedDependencyResult,
  parseWantedDependency,
} from '../parse-wanted-dependency/index.ts';
import {
  type GetPatchedDependencyOptions,
  getVersionsFromLockfile,
} from './getPatchedDependency.ts';
import { readEditDirState } from './stateFile.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return pick.default(['patches-dir'], allTypes);
}

export const commandNames = ['patch-commit'];

export function help(): string {
  return renderHelp({
    description: 'Generate a patch out of a directory',
    descriptionLists: [
      {
        title: 'Options',
        list: [
          {
            description:
              'The generated patch file will be saved to this directory',
            name: '--patches-dir',
          },
        ],
      },
    ],
    url: docsUrl('patch-commit'),
    usages: ['pnpm patch-commit <patchDir>'],
  });
}

type PatchCommitCommandOptions = install.InstallCommandOptions &
  Pick<Config, 'patchesDir' | 'rootProjectManifest' | 'rootProjectManifestDir'>;

export async function handler(
  opts: PatchCommitCommandOptions,
  params: string[]
  // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
): Promise<string | void> {
  const userDir = params[0];

  if (typeof userDir !== 'string') {
    throw new PnpmError('MISSING_ARG', 'Missing argument <patchDir>');
  }

  const lockfileDir = ((opts.lockfileDir ?? opts.dir) ||
    process.cwd()) as ProjectRootDir;

  const patchesDirName = normalizePath(
    path.normalize(opts.patchesDir ?? 'patches')
  );

  const patchesDir = path.join(lockfileDir, patchesDirName);

  const patchedPkgManifest = await readPackageJsonFromDir(userDir);

  const editDir = path.resolve(opts.dir, userDir);

  const stateValue = readEditDirState({
    editDir,
    modulesDir: path.join(opts.dir, opts.modulesDir ?? 'node_modules'),
  });

  if (!stateValue) {
    throw new PnpmError(
      'INVALID_PATCH_DIR',
      `${userDir} is not a valid patch directory`,
      {
        hint: 'A valid patch directory should be created by `pnpm patch`',
      }
    );
  }

  const { applyToAll } = stateValue;

  const nameAndVersion = `${patchedPkgManifest.name}@${patchedPkgManifest.version}`;

  const patchKey = applyToAll ? patchedPkgManifest.name : nameAndVersion;

  let gitTarballUrl: string | undefined;

  if (!applyToAll) {
    gitTarballUrl = await getGitTarballUrlFromLockfile(
      {
        alias: patchedPkgManifest.name,
        pref: patchedPkgManifest.version,
      },
      {
        lockfileDir,
        modulesDir: opts.modulesDir,
        virtualStoreDir: opts.virtualStoreDir,
      }
    );
  }

  const patchedPkg = parseWantedDependency(
    typeof gitTarballUrl === 'string'
      ? `${patchedPkgManifest.name}@${gitTarballUrl}`
      : nameAndVersion
  );

  const patchedPkgDir = await preparePkgFilesForDiff(userDir);

  const patchContent = await getPatchContent(
    {
      patchedPkg,
      patchedPkgDir,
      tmpName: createShortHash(editDir),
    },
    opts
  );

  if (patchedPkgDir !== userDir) {
    fs.rmSync(patchedPkgDir, { recursive: true });
  }

  if (!patchContent.length) {
    return `No changes were found to the following directory: ${userDir}`;
  }

  await fs.promises.mkdir(patchesDir, { recursive: true });

  const patchFileName = patchKey.replace('/', '__');

  await fs.promises.writeFile(
    path.join(patchesDir, `${patchFileName}.patch`),
    patchContent,
    'utf8'
  );

  const { writeProjectManifest, manifest } =
    await tryReadProjectManifest(lockfileDir);

  const rootProjectManifest: ProjectManifest =
    (opts.sharedWorkspaceLockfile === true
      ? (opts.rootProjectManifest ?? manifest)
      : manifest) ?? ({} as ProjectManifest);

  if (!('pnpm' in rootProjectManifest)) {
    (rootProjectManifest as ProjectManifest).pnpm = {
      patchedDependencies: {},
    };
  } else if (
    typeof rootProjectManifest.pnpm === 'object' &&
    'patchedDependencies' in rootProjectManifest.pnpm
  ) {
    rootProjectManifest.pnpm.patchedDependencies = {};
  }

  const pd = rootProjectManifest.pnpm?.patchedDependencies;

  if (typeof pd !== 'undefined') {
    pd[patchKey] = `${patchesDirName}/${patchFileName}.patch`;
  }

  await writeProjectManifest(rootProjectManifest);

  if (opts.selectedProjectsGraph?.[lockfileDir]) {
    opts.selectedProjectsGraph[lockfileDir].package.manifest =
      rootProjectManifest;
  }

  if (opts.allProjectsGraph?.[lockfileDir]?.package.manifest) {
    opts.allProjectsGraph[lockfileDir].package.manifest = rootProjectManifest;
  }

  return install.handler({
    ...opts,
    patchedDependencies: rootProjectManifest.pnpm?.patchedDependencies,
    rootProjectManifest,
    rawLocalConfig: {
      ...opts.rawLocalConfig,
      'frozen-lockfile': false,
    },
  });
}

type GetPatchContentContext = {
  patchedPkg: ParseWantedDependencyResult;
  patchedPkgDir: string;
  tmpName: string;
};

type GetPatchContentOptions = Pick<
  PatchCommitCommandOptions,
  'dir' | 'pnpmHomeDir' | 'storeDir'
> &
  WritePackageOptions;

async function getPatchContent(
  ctx: GetPatchContentContext,
  opts: GetPatchContentOptions
): Promise<string> {
  const storeDir = await getStorePath({
    pkgRoot: opts.dir,
    storePath: opts.storeDir,
    pnpmHomeDir: opts.pnpmHomeDir,
  });

  const srcDir = path.join(storeDir, 'tmp', 'patch-commit', ctx.tmpName);

  await writePackage(ctx.patchedPkg, srcDir, opts);

  const patchContent = await diffFolders(srcDir, ctx.patchedPkgDir);

  try {
    fs.rmSync(srcDir, { recursive: true });
  } catch (error) {
    globalWarn(
      `Failed to clean up temporary directory at ${srcDir} with error: ${String(error)}`
    );
  }
  return patchContent;
}

async function diffFolders(folderA: string, folderB: string): Promise<string> {
  const folderAN = folderA.replace(/\\/g, '/');

  const folderBN = folderB.replace(/\\/g, '/');

  let stdout!: string;

  let stderr!: string;

  try {
    const result = await execa.default(
      'git',
      [
        '-c',
        'core.safecrlf=false',
        'diff',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--ignore-cr-at-eol',
        '--irreversible-delete',
        '--full-index',
        '--no-index',
        '--text',
        '--no-ext-diff',
        folderAN,
        folderBN,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // #region Predictable output
          // These variables aim to ignore the global git config so we get predictable output
          // https://git-scm.com/docs/git#Documentation/git.txt-codeGITCONFIGNOSYSTEMcode
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: '',
          XDG_CONFIG_HOME: '',
          USERPROFILE: '',
          // #endregion
        },
        stripFinalNewline: false,
      }
    );

    stdout = result.stdout;

    stderr = result.stderr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    stdout = err.stdout;

    stderr = err.stderr;
  }

  // we cannot rely on exit code, because --no-index implies --exit-code
  // i.e. git diff will exit with 1 if there were differences
  if (stderr.length > 0)
    throw new Error(
      `Unable to diff directories. Make sure you have a recent version of 'git' available in PATH.\nThe following error was reported by 'git':\n${stderr}`
    );

  return stdout
    .replace(
      new RegExp(
        `(a|b)(${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(folderAN)}/`)})`,
        'g'
      ),
      '$1/'
    )
    .replace(
      new RegExp(
        `(a|b)${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(folderBN)}/`)}`,
        'g'
      ),
      '$1/'
    )
    .replace(new RegExp(escapeStringRegexp(`${folderAN}/`), 'g'), '')
    .replace(new RegExp(escapeStringRegexp(`${folderBN}/`), 'g'), '')
    .replace(/\n\\ No newline at end of file\n$/, '\n')
    .replace(
      /^diff --git a\/.*\.DS_Store b\/.*\.DS_Store[\S\s]+?(?=^diff --git)/gm,
      ''
    )
    .replace(/^diff --git a\/.*\.DS_Store b\/.*\.DS_Store[\S\s]*$/gm, '');
}

function removeTrailingAndLeadingSlash(p: string): string {
  if (p[0] === '/' || p.endsWith('/')) {
    return p.replace(/^\/|\/$/g, '');
  }
  return p;
}

/**
 * Link files from the source directory to a new temporary directory,
 * but only if not all files in the source directory should be included in the package.
 * If all files should be included, return the original source directory without creating any links.
 * This is required in order for the diff to not include files that are not part of the package.
 */
async function preparePkgFilesForDiff(src: string): Promise<string> {
  const files = Array.from(
    new Set((await packlist(src)).map((f) => path.join(f)))
  );

  // If there are no extra files in the source directories, then there is no reason
  // to copy.
  if (await areAllFilesInPkg(files, src)) {
    return src;
  }

  const dest = `${src}_tmp`;

  await makeEmptyDir(dest);

  await Promise.all(
    files.map(async (file: string): Promise<void> => {
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);
      const destDir = path.dirname(destFile);
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.link(srcFile, destFile);
    })
  );

  return dest;
}

async function areAllFilesInPkg(
  files: string[],
  basePath: string
): Promise<boolean> {
  const allFiles = await glob('**', {
    cwd: basePath,
    expandDirectories: false,
  });

  return equals.default(allFiles.sort(), files.sort());
}

async function getGitTarballUrlFromLockfile(
  dep: ParseWantedDependencyResult,
  opts: GetPatchedDependencyOptions
): Promise<string | undefined> {
  const { preferredVersions } = await getVersionsFromLockfile(dep, opts);

  return preferredVersions[0]?.gitTarballUrl;
}
