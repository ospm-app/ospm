import { BreakingChangeError } from './BreakingChangeError.ts';
import type { ErrorRelatedSources } from './ErrorRelatedSources.ts';

export type ModulesBreakingChangeErrorOptions = ErrorRelatedSources & {
  modulesPath: string;
};

export class ModulesBreakingChangeError extends BreakingChangeError {
  modulesPath: string;

  constructor(opts: ModulesBreakingChangeErrorOptions) {
    super({
      additionalInformation: opts.additionalInformation,
      code: 'MODULES_BREAKING_CHANGE',
      message: `The node_modules structure at "${opts.modulesPath}" is not compatible with the current ospm version. Run "ospm install --force" to recreate node_modules.`,
      relatedIssue: opts.relatedIssue,
      relatedPR: opts.relatedPR,
    });

    this.modulesPath = opts.modulesPath;
  }
}
