// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import bole from 'bole';

export function writeToConsole(): void {
  bole.output([
    {
      level: 'debug',
      stream: process.stdout,
    },
  ]);
}
