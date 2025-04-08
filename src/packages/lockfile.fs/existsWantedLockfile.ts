import fs from 'node:fs';
import path from 'node:path';
import { getWantedLockfileName } from './lockfileName.ts';

type existsNonEmptyWantedLockfileOptions = {
  useGitBranchLockfile?: boolean | undefined;
  mergeGitBranchLockfiles?: boolean | undefined;
};

export async function existsNonEmptyWantedLockfile(
  pkgPath: string | undefined,
  opts: existsNonEmptyWantedLockfileOptions = {
    useGitBranchLockfile: false,
    mergeGitBranchLockfiles: false,
  }
): Promise<boolean> {
  const wantedLockfile: string = await getWantedLockfileName(opts);

  return new Promise<boolean>((resolve, reject): void => {
    fs.access(
      path.join(pkgPath ?? '', wantedLockfile),
      (err: NodeJS.ErrnoException | null) => {
        if (err == null) {
          resolve(true);

          return;
        }

        if (err.code === 'ENOENT') {
          resolve(false);
          return;
        }
        reject(err);
      }
    );
  });
}
