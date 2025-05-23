import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { OspmError } from '../error/index.ts';
import {
  runLifecycleHook,
  type RunLifecycleHookOptions,
} from '../lifecycle/index.ts';
import { safeReadPackageJsonFromDir } from '../read-package-json/index.ts';
import type { PackageManifest } from '../types/index.ts';
import rimraf from '@zkochan/rimraf';
import preferredPM from 'preferred-pm';
import omit from 'ramda/src/omit';

// We don't run prepublishOnly to prepare the dependency.
// This might be counterintuitive as prepublishOnly is where a lot of packages put their build scripts.
// However, neither npm nor Yarn run prepublishOnly of git-hosted dependencies (checked on npm v10 and Yarn v3).
const PREPUBLISH_SCRIPTS = ['prepublish', 'prepack', 'publish'];

export type PreparePackageOptions = {
  ignoreScripts?: boolean | undefined;
  rawConfig: Record<string, unknown>;
  unsafePerm?: boolean | undefined;
};

export async function preparePackage(
  opts: PreparePackageOptions,
  gitRootDir: string,
  subDir: string
): Promise<{ shouldBeBuilt: boolean; pkgDir: string }> {
  const pkgDir = safeJoinPath(gitRootDir, subDir);

  const manifest = await safeReadPackageJsonFromDir(pkgDir);

  if (manifest?.scripts == null || !packageShouldBeBuilt(manifest, pkgDir)) {
    return { shouldBeBuilt: false, pkgDir };
  }

  if (opts.ignoreScripts === true) {
    return { shouldBeBuilt: true, pkgDir };
  }

  const pm = (await preferredPM(gitRootDir))?.name ?? 'npm';

  const execOpts: RunLifecycleHookOptions = {
    depPath: `${manifest.name}@${manifest.version}`,
    pkgRoot: pkgDir,
    // We can't prepare a package without running its lifecycle scripts.
    // An alternative solution could be to throw an exception.
    rawConfig: omit.default(['ignore-scripts'], opts.rawConfig),
    rootModulesDir: pkgDir, // We don't need this property but there is currently no way to not set it.
    unsafePerm: Boolean(opts.unsafePerm),
  };

  try {
    const installScriptName = `${pm}-install`;

    manifest.scripts[installScriptName] = `${pm} install`;

    await runLifecycleHook(installScriptName, manifest, execOpts);

    for (const scriptName of PREPUBLISH_SCRIPTS) {
      if (
        manifest.scripts[scriptName] == null ||
        manifest.scripts[scriptName] === ''
      ) {
        continue;
      }

      let newScriptName: string;

      if (pm !== 'ospm') {
        newScriptName = `${pm}-run-${scriptName}`;
        manifest.scripts[newScriptName] = `${pm} run ${scriptName}`;
      } else {
        newScriptName = scriptName;
      }

      await runLifecycleHook(newScriptName, manifest, execOpts);
    }
  } catch (err: unknown) {
    assert(util.types.isNativeError(err));

    Object.assign(err, {
      code: 'ERR_OSPM_PREPARE_PACKAGE',
    });

    throw err;
  }

  await rimraf(path.join(pkgDir, 'node_modules'));

  return { shouldBeBuilt: true, pkgDir };
}

function packageShouldBeBuilt(
  manifest: PackageManifest,
  pkgDir: string
): boolean {
  if (manifest.scripts == null) return false;
  const scripts = manifest.scripts;
  if (scripts.prepare != null && scripts.prepare !== '') return true;
  const hasPrepublishScript = PREPUBLISH_SCRIPTS.some(
    (scriptName) => scripts[scriptName] != null && scripts[scriptName] !== ''
  );
  if (!hasPrepublishScript) return false;
  const mainFile = manifest.main ?? 'index.js';
  return !fs.existsSync(path.join(pkgDir, mainFile));
}

function safeJoinPath(root: string, sub: string): string {
  const joined = path.join(root, sub);
  // prevent the dir traversal attack
  const relative = path.relative(root, joined);
  if (relative.startsWith('..')) {
    throw new OspmError(
      'INVALID_PATH',
      `Path "${sub}" should be a sub directory`
    );
  }
  if (!fs.existsSync(joined) || !fs.lstatSync(joined).isDirectory()) {
    throw new OspmError('INVALID_PATH', `Path "${sub}" is not a directory`);
  }
  return joined;
}
