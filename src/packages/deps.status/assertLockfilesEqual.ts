import { PnpmError } from '../error/index.ts';
import { equals } from 'ramda';
import type { LockfileObject } from '../lockfile.types/index.ts';

export function assertLockfilesEqual(
  currentLockfile: LockfileObject | null,
  wantedLockfile: LockfileObject,
  wantedLockfileDir: string
): void {
  if (!currentLockfile) {
    // make sure that no importer of wantedLockfile has any dependency
    for (const [name, snapshot] of Object.entries(
      wantedLockfile.importers ?? {}
    )) {
      if (!equals(snapshot.specifiers, {})) {
        throw new PnpmError(
          'RUN_CHECK_DEPS_NO_DEPS',
          `Project ${name} requires dependencies but none was installed.`,
          {
            hint: 'Run `pnpm install` to install dependencies',
          }
        );
      }
    }
  } else if (!equals(currentLockfile, wantedLockfile)) {
    throw new PnpmError(
      'RUN_CHECK_DEPS_OUTDATED_DEPS',
      `The installed dependencies in the modules directory is not up-to-date with the lockfile in ${wantedLockfileDir}.`,
      {
        hint: 'Run `pnpm install` to update dependencies.',
      }
    );
  }
}
