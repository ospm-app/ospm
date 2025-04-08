import { WANTED_LOCKFILE } from '../constants/index.ts';
import { getCurrentBranch } from '../git-utils/index.ts';

export type GetWantedLockfileNameOptions = {
  useGitBranchLockfile?: boolean | undefined;
  mergeGitBranchLockfiles?: boolean | undefined;
};

export async function getWantedLockfileName(
  opts: GetWantedLockfileNameOptions = {
    useGitBranchLockfile: false,
    mergeGitBranchLockfiles: false,
  }
): Promise<string> {
  if (
    opts.useGitBranchLockfile === true &&
    opts.mergeGitBranchLockfiles !== true
  ) {
    const currentBranchName = await getCurrentBranch();

    if (typeof currentBranchName === 'string') {
      return WANTED_LOCKFILE.replace(
        '.yaml',
        `.${stringifyBranchName(currentBranchName)}.yaml`
      );
    }
  }

  return WANTED_LOCKFILE;
}

/**
 * 1. Git branch name may contains slashes, which is not allowed in filenames
 * 2. Filesystem may be case-insensitive, so we need to convert branch name to lowercase
 */
function stringifyBranchName(branchName = ''): string {
  return branchName.replace(/[^\w.-]/g, '!').toLowerCase();
}
