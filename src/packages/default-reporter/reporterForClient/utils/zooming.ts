import { PREFIX_MAX_LENGTH } from '../outputConstants.ts';
import { formatPrefix } from './formatPrefix.ts';

export function autozoom(
  currentPrefix: string,
  logPrefix: string | undefined,
  line: string,
  opts: {
    zoomOutCurrent: boolean;
  }
): string {
  if (
    typeof logPrefix === 'undefined' ||
    (!opts.zoomOutCurrent && currentPrefix === logPrefix)
  ) {
    return line;
  }

  return zoomOut(currentPrefix, logPrefix, line);
}

export function zoomOut(
  currentPrefix: string,
  logPrefix: string,
  line: string
): string {
  const prefix: string = formatPrefix(currentPrefix, logPrefix);
  return `${prefix.padEnd(PREFIX_MAX_LENGTH)} | ${line}`;
}
