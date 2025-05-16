import { OspmError } from '../../../error/index.ts';
import type { ErrorRelatedSources } from './ErrorRelatedSources.ts';

export type BreakingChangeErrorOptions = ErrorRelatedSources & {
  code: string;
  message: string;
};

export class BreakingChangeError extends OspmError {
  relatedIssue?: number | undefined;
  relatedPR?: number | undefined;
  additionalInformation?: string | undefined;

  constructor(opts: BreakingChangeErrorOptions) {
    super(opts.code, opts.message);

    this.relatedIssue = opts.relatedIssue;

    this.relatedPR = opts.relatedPR;

    this.additionalInformation = opts.additionalInformation;
  }
}
