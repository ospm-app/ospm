import type { LogBase } from '../packages/logger/index.ts';

export function silentReporter(streamParser: {
  on: (event: 'data', handler: (obj: LogBase) => void) => void;
}): void {
  streamParser.on('data', (obj: LogBase): void => {
    if (obj.level !== 'error') {
      return;
    }

    // Known errors are not printed;
    if (obj.err?.code?.startsWith('ERR_OSPM_') === true) {
      return;
    }

    console.info(obj.err?.message ?? obj.message);

    if (typeof obj.err?.stack === 'string') {
      console.info(`\n${obj['err'].stack}`);
    }
  });
}
