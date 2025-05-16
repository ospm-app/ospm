import { OspmError } from '../error/index.ts';
import {
  isShellSupported,
  SUPPORTED_SHELLS,
  type SupportedShell,
} from '@pnpm/tabtab';

export function getShellFromString(shell?: string | undefined): SupportedShell {
  const newShell = shell?.trim();

  if (typeof newShell === 'undefined') {
    throw new OspmError(
      'MISSING_SHELL_NAME',
      '`ospm completion` requires a shell name'
    );
  }

  if (!isShellSupported(newShell)) {
    throw new OspmError('UNSUPPORTED_SHELL', `'${newShell}' is not supported`, {
      hint: `Supported shells are: ${SUPPORTED_SHELLS.join(', ')}`,
    });
  }

  return newShell;
}

export function getShellFromParams(params: string[]): SupportedShell {
  const [shell, ...rest] = params;

  if (rest.length) {
    throw new OspmError(
      'REDUNDANT_PARAMETERS',
      `The ${rest.length} parameters after shell is not necessary`
    );
  }

  return getShellFromString(shell);
}
