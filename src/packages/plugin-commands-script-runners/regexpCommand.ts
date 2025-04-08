import { PnpmError } from '../error/index.ts';

export function tryBuildRegExpFromCommand(command: string): RegExp | null {
  // https://github.com/stdlib-js/regexp-regexp/blob/6428051ac9ef7c9d03468b19bdbb1dc6fc2a5509/lib/regexp.js
  // eslint-disable-next-line optimize-regex/optimize-regex
  const regExpDetectRegExpScriptCommand = /^\/((?:\\\/|[^/])+)\/([dgimuvys]*)$/;

  const match = command.match(regExpDetectRegExpScriptCommand);

  // if the passed script selector is not in the format of RegExp literal like /build:.*/, return null and handle it as a string script command
  if (!match) {
    return null;
  }

  // if the passed RegExp script selector includes flag, report the error because RegExp flag is not useful for script selector and pnpm does not support this.
  if (typeof match[2] !== 'undefined') {
    throw new PnpmError(
      'UNSUPPORTED_SCRIPT_COMMAND_FORMAT',
      'RegExp flags are not supported in script command selector'
    );
  }

  try {
    const m = match[1];

    if (typeof m !== 'string') {
      return null;
    }

    return new RegExp(m);
  } catch {
    return null;
  }
}
