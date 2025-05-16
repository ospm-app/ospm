import { promises as fs, existsSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { OspmError } from '../error/index.ts';
import { logger, globalWarn } from '../logger/index.ts';
import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import {
  type Command,
  getBinsFromPackageManifest,
} from '../package-bins/index.ts';
import { readModulesDir } from '../read-modules-dir/index.ts';
import { readPackageJsonFromDir } from '../read-package-json/index.ts';
import { safeReadProjectManifestOnly } from '../read-project-manifest/index.ts';
import type {
  DependencyManifest,
  ModulesDir,
  ProjectManifest,
} from '../types/index.ts';
import cmdShim from '@zkochan/cmd-shim';
import rimraf from '@zkochan/rimraf';
import isSubdir from 'is-subdir';
import isWindows from 'is-windows';
import normalizePath from 'normalize-path';
import pSettle from 'p-settle';
import isEmpty from 'ramda/src/isEmpty';
import unnest from 'ramda/src/unnest';
import groupBy from 'ramda/src/groupBy';
import partition from 'ramda/src/partition';
import semver from 'semver';
import symlinkDir from 'symlink-dir';
import process from 'node:process';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import fixBin from 'bin-links/lib/fix-bin';
import type { BundledManifest } from '../package-store/index.ts';

const binsConflictLogger = logger('bins-conflict');
const IS_WINDOWS = isWindows();
const EXECUTABLE_SHEBANG_SUPPORTED = !IS_WINDOWS;
const POWER_SHELL_IS_SUPPORTED = IS_WINDOWS;

export type WarningCode = 'BINARIES_CONFLICT' | 'EMPTY_BIN';

export type WarnFunction = (msg: string, code: WarningCode) => void;

export async function linkBins(
  modulesDir: ModulesDir,
  binsDir: string,
  opts: LinkBinOptions & {
    allowExoticManifests?: boolean | undefined;
    nodeExecPathByAlias?: Record<string, string> | undefined;
    projectManifest?: ProjectManifest | undefined;
    warn: WarnFunction;
  }
): Promise<string[]> {
  const allDeps = await readModulesDir(modulesDir);

  // If the modules dir does not exist, do nothing
  if (allDeps === null) {
    return [];
  }

  return linkBinsOfPkgsByAliases(allDeps, binsDir, {
    ...opts,
    modulesDir,
  });
}

export async function linkBinsOfPkgsByAliases(
  depsAliases: string[],
  binsDir: string,
  opts: LinkBinOptions & {
    modulesDir: ModulesDir;
    allowExoticManifests?: boolean | undefined;
    nodeExecPathByAlias?: Record<string, string> | undefined;
    projectManifest?: ProjectManifest | undefined;
    warn: WarnFunction;
  }
): Promise<string[]> {
  const pkgBinOpts = {
    allowExoticManifests: false,
    ...opts,
  };

  const directDependencies =
    opts.projectManifest == null
      ? undefined
      : new Set(
          Object.keys(getAllDependenciesFromManifest(opts.projectManifest))
        );

  const allCmds = unnest.default(
    (
      await Promise.all(
        depsAliases
          .map((alias) => ({
            depDir: path.resolve(opts.modulesDir, alias),
            isDirectDependency: directDependencies?.has(alias),
            nodeExecPath: opts.nodeExecPathByAlias?.[alias],
          }))
          .filter(({ depDir }) => !isSubdir(depDir, binsDir)) // Don't link own bins
          .map(async ({ depDir, isDirectDependency, nodeExecPath }) => {
            const target = normalizePath(depDir);
            const cmds = await getPackageBins(pkgBinOpts, target, nodeExecPath);
            return cmds.map((cmd) => ({ ...cmd, isDirectDependency }));
          })
      )
    ).filter((cmds: Command[]) => cmds.length)
  );

  const cmdsToLink =
    directDependencies != null ? preferDirectCmds(allCmds) : allCmds;
  return _linkBins(cmdsToLink, binsDir, opts);
}

function preferDirectCmds(
  allCmds: Array<CommandInfo & { isDirectDependency?: boolean | undefined }>
): Array<
  CommandInfo & {
    isDirectDependency?: boolean | undefined;
  }
> {
  const [directCmds, hoistedCmds] = partition.default(
    (cmd) => cmd.isDirectDependency === true,
    allCmds
  );

  const usedDirectCmds = new Set(directCmds.map((directCmd) => directCmd.name));

  return [
    ...directCmds,
    ...hoistedCmds.filter(({ name }) => !usedDirectCmds.has(name)),
  ];
}

export async function linkBinsOfPackages(
  pkgs: Array<{
    manifest: BundledManifest;
    nodeExecPath?: string | undefined;
    location: string;
  }>,
  binsTarget: string,
  opts: LinkBinOptions = {}
): Promise<string[]> {
  if (pkgs.length === 0) {
    return [];
  }

  const allCmds = unnest.default(
    (
      await Promise.all(
        pkgs.map(
          async (pkg: {
            manifest: BundledManifest;
            nodeExecPath?: string | undefined;
            location: string;
          }): Promise<CommandInfo[]> => {
            return getPackageBinsFromManifest(
              pkg.manifest,
              pkg.location,
              pkg.nodeExecPath
            );
          }
        )
      )
    ).filter((cmds: Command[]): boolean => {
      return cmds.length > 0;
    })
  );

  return _linkBins(allCmds, binsTarget, opts);
}

interface CommandInfo extends Command {
  ownName: boolean;
  pkgName: string;
  pkgVersion: string;
  makePowerShellShim: boolean;
  nodeExecPath?: string | undefined;
}

async function _linkBins(
  allCmds: CommandInfo[],
  binsDir: string,
  opts: LinkBinOptions
): Promise<string[]> {
  if (allCmds.length === 0) return [] as string[];

  // deduplicate bin names to prevent race conditions (multiple writers for the same file)
  const dedupedAllCmds = deduplicateCommands(allCmds, binsDir);

  await fs.mkdir(binsDir, { recursive: true });

  const results = await pSettle(
    dedupedAllCmds.map(async (cmd) => linkBin(cmd, binsDir, opts))
  );

  // We want to create all commands that we can create before throwing an exception
  for (const result of results) {
    if (result.isRejected) {
      throw result.reason;
    }
  }

  return dedupedAllCmds.map((cmd) => cmd.pkgName);
}

function deduplicateCommands(
  commands: CommandInfo[],
  binsDir: string
): CommandInfo[] {
  const cmdGroups = groupBy.default((cmd) => cmd.name, commands);

  return Object.values(cmdGroups)
    .filter((group): group is CommandInfo[] => {
      return group !== undefined && group.length !== 0;
    })
    .map((group: CommandInfo[]): CommandInfo => {
      return resolveCommandConflicts(group, binsDir);
    });
}

function resolveCommandConflicts(
  group: CommandInfo[],
  binsDir: string
): CommandInfo {
  return group.reduce((a: CommandInfo, b: CommandInfo): CommandInfo => {
    const [chosen, skipped] =
      compareCommandsInConflict(a, b) >= 0 ? [a, b] : [b, a];

    logCommandConflict(chosen, skipped, binsDir);

    return chosen;
  });
}

function compareCommandsInConflict(a: CommandInfo, b: CommandInfo): number {
  if (a.ownName && !b.ownName) {
    return 1;
  }

  if (!a.ownName && b.ownName) {
    return -1;
  }

  if (a.pkgName !== b.pkgName) {
    // it's pointless to compare versions of 2 different package
    return a.pkgName.localeCompare(b.pkgName);
  }

  return semver.compare(a.pkgVersion, b.pkgVersion);
}

function logCommandConflict(
  chosen: CommandInfo,
  skipped: CommandInfo,
  binsDir: string
): void {
  binsConflictLogger.debug({
    binaryName: skipped.name,
    binsDir,
    linkedPkgName: chosen.pkgName,
    linkedPkgVersion: chosen.pkgVersion,
    skippedPkgName: skipped.pkgName,
    skippedPkgVersion: skipped.pkgVersion,
  });
}

async function isFromModules(filename: string): Promise<boolean> {
  const real = await fs.realpath(filename);
  return normalizePath(real).includes('/node_modules/');
}

async function getPackageBins(
  opts: {
    allowExoticManifests?: boolean | undefined;
    warn: WarnFunction;
  },
  target: string,
  nodeExecPath?: string | undefined
): Promise<CommandInfo[]> {
  const manifest =
    opts.allowExoticManifests === true
      ? ((await safeReadProjectManifestOnly(target)) as DependencyManifest)
      : await safeReadPkgJson(target);

  if (manifest == null) {
    // There's a directory in node_modules without package.json: ${target}.
    // This used to be a warning but it didn't really cause any issues.
    return [];
  }

  if (isEmpty.default(manifest.bin) && !(await isFromModules(target))) {
    opts.warn(
      `Package in ${target} must have a non-empty bin field to get bin linked.`,
      'EMPTY_BIN'
    );
  }

  if (typeof manifest.bin === 'string' && !manifest.name) {
    throw new OspmError(
      'INVALID_PACKAGE_NAME',
      `Package in ${target} must have a name to get bin linked.`
    );
  }

  return getPackageBinsFromManifest(manifest, target, nodeExecPath);
}

async function getPackageBinsFromManifest(
  manifest: DependencyManifest,
  pkgDir: string,
  nodeExecPath?: string
): Promise<CommandInfo[]> {
  const cmds = await getBinsFromPackageManifest(manifest, pkgDir);

  return cmds.map((cmd: Command): CommandInfo => {
    return {
      ...cmd,
      ownName: cmd.name === manifest.name,
      pkgName: manifest.name,
      pkgVersion: manifest.version,
      makePowerShellShim: POWER_SHELL_IS_SUPPORTED && manifest.name !== 'ospm',
      nodeExecPath,
    };
  });
}

export interface LinkBinOptions {
  extraNodePaths?: string[] | undefined;
  preferSymlinkedExecutables?: boolean | undefined;
}

async function linkBin(
  cmd: CommandInfo,
  binsDir: string,
  opts?: LinkBinOptions | undefined
): Promise<void> {
  const externalBinPath = path.join(binsDir, cmd.name);

  if (IS_WINDOWS) {
    const exePath = path.join(binsDir, `${cmd.name}${getExeExtension()}`);

    if (existsSync(exePath)) {
      globalWarn(
        `The target bin directory already contains an exe called ${cmd.name}, so removing ${exePath}`
      );
      await rimraf(exePath);
    }
  }

  if (
    opts?.preferSymlinkedExecutables === true &&
    !IS_WINDOWS &&
    cmd.nodeExecPath == null
  ) {
    try {
      await symlinkDir(cmd.path, externalBinPath);

      await fixBin(cmd.path, 0o755);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }

      globalWarn(
        `Failed to create bin at ${externalBinPath}. ${err.message as string}`
      );
    }

    return;
  }

  try {
    let nodePath: string[] = [];

    if (typeof opts?.extraNodePaths?.length === 'number') {
      nodePath = [];

      for (const modulesPath of await getBinNodePaths(cmd.path)) {
        if (opts.extraNodePaths.includes(modulesPath)) break;

        nodePath.push(modulesPath);
      }

      nodePath.push(...opts.extraNodePaths);
    }

    await cmdShim(cmd.path, externalBinPath, {
      createPwshFile: cmd.makePowerShellShim,
      nodePath,
      nodeExecPath: cmd.nodeExecPath ?? '',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }

    globalWarn(
      `Failed to create bin at ${externalBinPath}. ${err.message as string}`
    );

    return;
  }

  // ensure that bin are executable and not containing
  // windows line-endings(CRLF) on the hashbang line
  if (EXECUTABLE_SHEBANG_SUPPORTED) {
    await fixBin(cmd.path, 0o7_5_5);
  }
}

function getExeExtension(): string {
  let cmdExtension: string | undefined;

  if (typeof process.env.PATHEXT === 'string') {
    cmdExtension = process.env.PATHEXT.split(path.delimiter).find(
      (ext) => ext.toUpperCase() === '.EXE'
    );
  }

  return cmdExtension ?? '.exe';
}

async function getBinNodePaths(target: string): Promise<string[]> {
  const targetDir = path.dirname(target);

  try {
    const targetRealPath = await fs.realpath(targetDir);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error

    return Module['_nodeModulePaths'](targetRealPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    return Module['_nodeModulePaths'](targetDir);
  }
}

async function safeReadPkgJson(
  pkgDir: string
): Promise<DependencyManifest | null> {
  try {
    return await readPackageJsonFromDir(pkgDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw err;
  }
}
