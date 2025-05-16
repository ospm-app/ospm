import { OspmError } from '../../error/index.ts';

export class LockfileBreakingChangeError extends OspmError {
  filename: string;

  constructor(filename: string) {
    super(
      'LOCKFILE_BREAKING_CHANGE',
      `Lockfile ${filename} not compatible with current ospm`
    );

    this.filename = filename;
  }
}
