import { PnpmError } from '../error/index.ts';
import {
  isShellSupported,
  SUPPORTED_SHELLS,
  type SupportedShell,
} from '@pnpm/tabtab';

export function getShellFromString(shell?: string | undefined): SupportedShell {
  const newShell = shell?.trim();

  if (typeof newShell === 'undefined') {
    throw new PnpmError(
      'MISSING_SHELL_NAME',
      '`pnpm completion` requires a shell name'
    );
  }

  if (!isShellSupported(newShell)) {
    throw new PnpmError('UNSUPPORTED_SHELL', `'${newShell}' is not supported`, {
      hint: `Supported shells are: ${SUPPORTED_SHELLS.join(', ')}`,
    });
  }

  return newShell;
}

export function getShellFromParams(params: string[]): SupportedShell {
  const [shell, ...rest] = params;

  if (rest.length) {
    throw new PnpmError(
      'REDUNDANT_PARAMETERS',
      `The ${rest.length} parameters after shell is not necessary`
    );
  }

  return getShellFromString(shell);
}
