import { PnpmError } from '../../error/index.ts';

export class BadTarballError extends PnpmError {
  expectedSize: number;
  receivedSize: number;
  constructor(opts: {
    attempts?: number | undefined;
    expectedSize: number;
    receivedSize: number;
    tarballUrl: string;
  }) {
    const message = `Actual size (${opts.receivedSize}) of tarball (${opts.tarballUrl}) did not match the one specified in 'Content-Length' header (${opts.expectedSize})`;

    super('BAD_TARBALL_SIZE', message, {
      attempts: opts.attempts,
    });

    this.expectedSize = opts.expectedSize;

    this.receivedSize = opts.receivedSize;
  }
}
