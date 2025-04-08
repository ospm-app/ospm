import assert from 'node:assert';
import path from 'node:path';
import util from 'node:util';
import type { GitFetcher } from '../fetcher-base/index.ts';
import { packlist } from '../fs.packlist/index.ts';
import { globalWarn } from '../logger/index.ts';
import { preparePackage } from '../prepare-package/index.ts';
import { addFilesFromDir, type AddFilesResult } from '../worker/index.ts';
import rimraf from '@zkochan/rimraf';
import { execa } from 'execa';
import { URL } from 'node:url';
import type { Cafs } from '../cafs-types/index.ts';
import type { GitResolution } from '../resolver-base/index.ts';

export type CreateGitFetcherOptions = {
  gitShallowHosts?: string[] | undefined;
  rawConfig: Record<string, unknown>;
  unsafePerm?: boolean | undefined;
  ignoreScripts?: boolean | undefined;
};

export function createGitFetcher(createOpts: CreateGitFetcherOptions): {
  git: GitFetcher;
} {
  const allowedHosts = new Set(createOpts.gitShallowHosts ?? []);

  const ignoreScripts = createOpts.ignoreScripts ?? false;

  const preparePkg = preparePackage.bind(null, {
    ignoreScripts: createOpts.ignoreScripts,
    rawConfig: createOpts.rawConfig,
    unsafePerm: createOpts.unsafePerm,
  });

  const gitFetcher: GitFetcher = async (
    cafs: Cafs,
    resolution: GitResolution,
    opts
  ): Promise<AddFilesResult> => {
    const tempLocation = await cafs.tempDir();

    if (
      typeof resolution.repo !== 'string' ||
      typeof resolution.commit !== 'string'
    ) {
      throw new Error('Invalid git resolution');
    }

    if (
      allowedHosts.size > 0 &&
      shouldUseShallow(resolution.repo, allowedHosts)
    ) {
      await execGit(['init'], { cwd: tempLocation });
      await execGit(['remote', 'add', 'origin', resolution.repo], {
        cwd: tempLocation,
      });
      await execGit(['fetch', '--depth', '1', 'origin', resolution.commit], {
        cwd: tempLocation,
      });
    } else {
      await execGit(['clone', resolution.repo, tempLocation]);
    }

    await execGit(['checkout', resolution.commit], { cwd: tempLocation });

    let pkgDir: string;

    try {
      const prepareResult = await preparePkg(tempLocation, resolution.path);

      pkgDir = prepareResult.pkgDir;

      if (ignoreScripts && prepareResult.shouldBeBuilt) {
        globalWarn(
          `The git-hosted package fetched from "${resolution.repo}" has to be built but the build scripts were ignored.`
        );
      }
    } catch (err: unknown) {
      assert(util.types.isNativeError(err));

      err.message = `Failed to prepare git-hosted package fetched from "${resolution.repo}": ${err.message}`;

      throw err;
    }

    // removing /.git to make directory integrity calculation faster
    await rimraf(path.join(tempLocation, '.git'));

    const files = await packlist(pkgDir);

    // Important! We cannot remove the temp location at this stage.
    // Even though we have the index of the package,
    // the linking of files to the store is in progress.
    return addFilesFromDir({
      storeDir: cafs.storeDir,
      dir: pkgDir,
      files,
      filesIndexFile: opts.filesIndexFile,
      readManifest: opts.readManifest,
      pkg: opts.pkg,
    });
  };

  return {
    git: gitFetcher,
  };
}

function shouldUseShallow(repoUrl: string, allowedHosts: Set<string>): boolean {
  try {
    const { host } = new URL(repoUrl);

    if (allowedHosts.has(host)) {
      return true;
    }
  } catch {
    // URL might be malformed
  }

  return false;
}

function prefixGitArgs(): string[] {
  return process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
}

async function execGit(
  args: string[],
  opts?: object | undefined
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
  const fullArgs = prefixGitArgs().concat(args || []);
  await execa('git', fullArgs, opts);
}
