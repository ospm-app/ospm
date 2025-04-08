import { PnpmError } from '../../error/index.ts';

export class InvalidWorkspaceManifestError extends PnpmError {
  constructor(message: string) {
    super('INVALID_WORKSPACE_CONFIGURATION', message);
  }
}
