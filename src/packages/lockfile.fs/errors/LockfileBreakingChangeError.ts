import { PnpmError } from '../../error/index.ts';

export class LockfileBreakingChangeError extends PnpmError {
  filename: string;

  constructor(filename: string) {
    super(
      'LOCKFILE_BREAKING_CHANGE',
      `Lockfile ${filename} not compatible with current pnpm`
    );

    this.filename = filename;
  }
}
