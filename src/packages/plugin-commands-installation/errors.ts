import { OspmError } from '../error/index.ts';

export class IgnoredBuildsError extends OspmError {
  constructor(ignoredBuilds: string[]) {
    super(
      'IGNORED_BUILDS',
      `Ignored build scripts: ${ignoredBuilds.join(', ')}`,
      {
        hint: 'Run "ospm approve-builds" to pick which dependencies should be allowed to run scripts.',
      }
    );
  }
}
