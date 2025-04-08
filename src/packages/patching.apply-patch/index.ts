import { PnpmError } from '../error/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { applyPatch } from '@pnpm/patch-package/dist/applyPatches';
import { globalWarn } from '../logger/index.ts';

export type ApplyPatchToDirOpts = {
  allowFailure?: boolean | undefined;
  patchedDir: string;
  patchFilePath: string;
};

export function applyPatchToDir(opts: ApplyPatchToDirOpts): boolean {
  // Ideally, we would just run "patch" or "git apply".
  // However, "patch" is not available on Windows and "git apply" is hard to execute on a subdirectory of an existing repository
  const cwd = process.cwd();

  process.chdir(opts.patchedDir);

  let success = false;

  try {
    success = applyPatch({
      patchFilePath: opts.patchFilePath,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new PnpmError(
        'PATCH_NOT_FOUND',
        `Patch file not found: ${opts.patchFilePath}`
      );
    }

    throw new PnpmError(
      'INVALID_PATCH',
      `Applying patch "${opts.patchFilePath}" failed: ${err.message as string}`
    );
  } finally {
    process.chdir(cwd);
  }

  if (!success) {
    const message = `Could not apply patch ${opts.patchFilePath} to ${opts.patchedDir}`;
    if (opts.allowFailure === true) {
      globalWarn(message);
    } else {
      throw new PnpmError('PATCH_FAILED', message);
    }
  }

  return success;
}
