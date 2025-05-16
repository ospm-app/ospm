import { OspmError } from '../../error/index.ts';

export class InvalidWorkspaceManifestError extends OspmError {
  constructor(message: string) {
    super('INVALID_WORKSPACE_CONFIGURATION', message);
  }
}
