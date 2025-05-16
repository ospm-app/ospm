import fs, { type Stats } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { docsUrl } from '../cli-utils/index.ts';
import { createResolver } from '../client/index.ts';
import { parseWantedDependency } from '../parse-wanted-dependency/index.ts';
import { OUTPUT_OPTIONS } from '../common-cli-options-help/index.ts';
import type { Config } from '../config/index.ts';
import { types } from '../config/types.ts';
import { createHexHash } from '../crypto.hash/index.ts';
import { OspmError } from '../error/index.ts';
import { add } from '../plugin-commands-installation/index.ts';
import { readPackageJsonFromDir } from '../read-package-json/index.ts';
import {
  getBinsFromPackageManifest,
  type Command,
} from '../package-bins/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import type {
  LockFileDir,
  OspmSettings,
  ProjectRootDirRealPath,
} from '../types/index.ts';
import * as execa from 'execa';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import symlinkDir from 'symlink-dir';
import { makeEnv } from './makeEnv.ts';
import type { AddCommandOptions } from '../plugin-commands-installation/add.ts';

export const skipPackageManagerCheck = true;

export const commandNames = ['dlx'];

export const shorthands: Record<string, string> = {
  c: '--shell-mode',
};

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(['use-node-version'], types),
    'shell-mode': Boolean,
  };
}

export const cliOptionsTypes = (): Record<string, unknown> => ({
  ...rcOptionsTypes(),
  package: [String, Array],
  'allow-build': [String, Array],
});

export function help(): string {
  return renderHelp({
    description: 'Run a package in a temporary environment.',
    descriptionLists: [
      {
        title: 'Options',
        list: [
          {
            description: 'The package to install before running the command',
            name: '--package',
          },
          {
            description:
              'A list of package names that are allowed to run postinstall scripts during installation',
            name: '--allow-build',
          },
          {
            description:
              'Runs the script inside of a shell. Uses /bin/sh on UNIX and \\cmd.exe on Windows.',
            name: '--shell-mode',
            shortAlias: '-c',
          },
        ],
      },
      OUTPUT_OPTIONS,
    ],
    url: docsUrl('dlx'),
    usages: ['ospm dlx <command> [args...]'],
  });
}

export type DlxCommandOptions = {
  package?: string[] | undefined;
  shellMode?: boolean | undefined;
  allowBuild?: string[] | undefined;
} & Pick<
  Config,
  | 'extraBinPaths'
  | 'registries'
  | 'reporter'
  | 'userAgent'
  | 'cacheDir'
  | 'dlxCacheMaxAge'
  | 'useNodeVersion'
  | 'symlink'
> &
  AddCommandOptions &
  OspmSettings;

export async function handler(
  opts: DlxCommandOptions,
  [command, ...args]: string[]
): Promise<{ exitCode: number }> {
  const pkgs = (opts.package ?? [command]).filter(Boolean);

  const { resolve } = createResolver({
    ...opts,
    authConfig: opts.rawConfig,
  });

  const resolvedPkgAliases: string[] = [];

  const resolvedPkgs = await Promise.all(
    pkgs.map(async (pkg) => {
      const { alias, pref } = parseWantedDependency(pkg); // || {};

      if (typeof alias === 'undefined' || typeof pref === 'undefined') {
        return pkg;
      }

      resolvedPkgAliases.push(alias);

      const resolved = await resolve(
        { alias, pref },
        {
          lockfileDir: opts.lockfileDir ?? opts.dir,
          preferredVersions: {},
          projectDir: opts.dir,
          registry: pickRegistryForPackage(opts.registries, alias, pref),
        }
      );

      return resolved.id;
    })
  );

  const { cacheLink, cacheExists, cachedDir } = findCache(resolvedPkgs, {
    dlxCacheMaxAge: opts.dlxCacheMaxAge,
    cacheDir: opts.cacheDir,
    registries: opts.registries,
    allowBuild: opts.allowBuild ?? [],
  });

  if (!cacheExists) {
    fs.mkdirSync(cachedDir, { recursive: true });

    await add.handler(
      {
        ...opts,
        bin: path.join(cachedDir, 'node_modules', '.bin'),
        dir: cachedDir as ProjectRootDirRealPath,
        lockfileDir: cachedDir as LockFileDir,
        onlyBuiltDependencies: [
          ...resolvedPkgAliases,
          ...(opts.allowBuild ?? []),
        ],
        saveProd: true, // dlx will be looking for the package in the "dependencies" field!
        saveDev: false,
        saveOptional: false,
        savePeer: false,
        symlink: true,
        workspaceDir: undefined,
      },
      resolvedPkgs
    );

    try {
      await symlinkDir(cachedDir, cacheLink, { overwrite: true });
    } catch (error) {
      // EBUSY means that there is another dlx process running in parallel that has acquired the cache link first.
      // Similarly, EEXIST means that another dlx process has created the cache link before this process.
      // The link created by the other process is just as up-to-date as the link the current process was attempting
      // to create. Therefore, instead of re-attempting to create the current link again, it is just as good to let
      // the other link stay. The current process should yield.
      if (
        !util.types.isNativeError(error) ||
        !('code' in error) ||
        (error.code !== 'EBUSY' && error.code !== 'EEXIST')
      ) {
        throw error;
      }
    }
  }

  const modulesDir = path.join(cachedDir, 'node_modules');

  const binsDir = path.join(modulesDir, '.bin');

  const env = makeEnv({
    userAgent: opts.userAgent,
    prependPaths: [binsDir, ...opts.extraBinPaths],
  });

  const binName = opts.package
    ? command
    : await getBinName(modulesDir, await getPkgName(cachedDir));

  if (typeof binName !== 'string') {
    throw new OspmError('DLX_NO_BIN', `No binary found for ${command}`);
  }

  try {
    await execa.execa(binName, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      shell: opts.shellMode ?? false,
    });
  } catch (err: unknown) {
    if (
      util.types.isNativeError(err) &&
      'exitCode' in err &&
      err.exitCode != null
    ) {
      return {
        exitCode: err.exitCode as number,
      };
    }

    throw err;
  }

  return { exitCode: 0 };
}

async function getPkgName(pkgDir: string): Promise<string> {
  const manifest = await readPackageJsonFromDir(pkgDir);

  const dependencyNames = Object.keys(manifest.dependencies ?? {});

  const dependencyName = dependencyNames[0];

  if (dependencyNames.length === 0 || typeof dependencyName !== 'string') {
    throw new OspmError(
      'DLX_NO_DEP',
      'dlx was unable to find the installed dependency in "dependencies"'
    );
  }

  return dependencyName;
}

async function getBinName(
  modulesDir: string,
  pkgName: string
): Promise<string> {
  const pkgDir = path.join(modulesDir, pkgName);
  const manifest = await readPackageJsonFromDir(pkgDir);
  const bins = await getBinsFromPackageManifest(manifest, pkgDir);
  if (bins.length === 0) {
    throw new OspmError('DLX_NO_BIN', `No binaries found in ${pkgName}`);
  }

  const firstBin = bins[0];

  if (bins.length === 1 && typeof firstBin !== 'undefined') {
    return firstBin.name;
  }

  if (typeof manifest.name !== 'string') {
    throw new OspmError('DLX_NO_NAME', `No name found in ${pkgName}`);
  }

  const scopelessPkgName = scopeless(manifest.name);

  const defaultBin = bins.find(({ name }: Command): boolean => {
    return name === scopelessPkgName;
  });

  if (defaultBin) return defaultBin.name;

  const binNames = bins.map(({ name }: Command): string => {
    return name;
  });

  throw new OspmError(
    'DLX_MULTIPLE_BINS',
    `Could not determine executable to run. ${pkgName} has multiple binaries: ${binNames.join(', ')}`,
    {
      hint: `Try one of the following:
${binNames.map((name) => `ospm --package=${pkgName} dlx ${name}`).join('\n')}
`,
    }
  );
}

function scopeless(pkgName: string): string {
  if (pkgName.startsWith('@')) {
    return pkgName.split('/')[1] ?? pkgName;
  }

  return pkgName;
}

function findCache(
  pkgs: string[],
  opts: {
    cacheDir: string;
    dlxCacheMaxAge: number;
    registries: Record<string, string>;
    allowBuild: string[];
  }
): { cacheLink: string; cacheExists: boolean; cachedDir: string } {
  const dlxCommandCacheDir = createDlxCommandCacheDir(pkgs, opts);

  const cacheLink = path.join(dlxCommandCacheDir, 'pkg');

  const cachedDir = getValidCacheDir(cacheLink, opts.dlxCacheMaxAge);

  return {
    cacheLink,
    cachedDir: cachedDir ?? getPrepareDir(dlxCommandCacheDir),
    cacheExists: cachedDir != null,
  };
}

function createDlxCommandCacheDir(
  pkgs: string[],
  opts: {
    registries: Record<string, string>;
    cacheDir: string;
    allowBuild: string[];
  }
): string {
  const dlxCacheDir = path.resolve(opts.cacheDir, 'dlx');

  const cacheKey = createCacheKey(pkgs, opts.registries, opts.allowBuild);

  const cachePath = path.join(dlxCacheDir, cacheKey);

  fs.mkdirSync(cachePath, { recursive: true });

  return cachePath;
}

export function createCacheKey(
  pkgs: string[],
  registries: Record<string, string>,
  allowBuild?: string[] | undefined
): string {
  const sortedPkgs = [...pkgs].sort((a, b) => a.localeCompare(b));

  const sortedRegistries = Object.entries(registries).sort(([k1], [k2]) => {
    return k1.localeCompare(k2);
  });

  const args: unknown[] = [sortedPkgs, sortedRegistries];

  if (Array.isArray(allowBuild) && allowBuild.length > 0) {
    args.push({
      allowBuild: allowBuild.sort((pkg1, pkg2) => {
        return pkg1.localeCompare(pkg2);
      }),
    });
  }

  const hashStr = JSON.stringify(args);

  return createHexHash(hashStr);
}

function getValidCacheDir(
  cacheLink: string,
  dlxCacheMaxAge: number
): string | undefined {
  let stats: Stats;

  let target: string;

  try {
    stats = fs.lstatSync(cacheLink);

    if (stats.isSymbolicLink()) {
      target = fs.realpathSync(cacheLink);

      if (!target) {
        return undefined;
      }
    } else {
      return undefined;
    }
  } catch (err) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return undefined;
    }

    throw err;
  }

  const isValid =
    stats.mtime.getTime() + dlxCacheMaxAge * 60_000 >= new Date().getTime();

  return isValid ? target : undefined;
}

function getPrepareDir(cachePath: string): string {
  const name = `${new Date().getTime().toString(16)}-${process.pid.toString(16)}`;

  return path.join(cachePath, name);
}
