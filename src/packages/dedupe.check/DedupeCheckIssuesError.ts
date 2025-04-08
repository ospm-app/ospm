import type { DedupeCheckIssues } from '../dedupe.types/index.ts';
import { PnpmError } from '../error/index.ts';

export class DedupeCheckIssuesError extends PnpmError {
  constructor(_dedupeCheckIssues: DedupeCheckIssues) {
    super(
      'DEDUPE_CHECK_ISSUES',
      'Dedupe --check found changes to the lockfile'
    );
  }
}
