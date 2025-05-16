import type { DedupeCheckIssues } from '../dedupe.types/index.ts';
import { OspmError } from '../error/index.ts';

export class DedupeCheckIssuesError extends OspmError {
  constructor(_dedupeCheckIssues: DedupeCheckIssues) {
    super(
      'DEDUPE_CHECK_ISSUES',
      'Dedupe --check found changes to the lockfile'
    );
  }
}
