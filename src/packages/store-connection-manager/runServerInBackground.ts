import { PnpmError } from '../error/index.ts';
// cspell:ignore diable
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import diable from '@zkochan/diable';

export function runServerInBackground(storePath: string): void {
  if (require.main == null) {
    throw new PnpmError(
      'CANNOT_START_SERVER',
      'pnpm server cannot be started when pnpm is streamed to Node.js'
    );
  }

  diable.daemonize(
    require.main.filename,
    ['server', 'start', '--store-dir', storePath],
    { stdio: 'inherit' }
  );

  return;
}
