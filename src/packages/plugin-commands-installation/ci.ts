import { docsUrl } from '../cli-utils/index.ts';
import { PnpmError } from '../error/index.ts';
import renderHelp from 'render-help';

export const rcOptionsTypes = (): Record<string, unknown> => ({});

export const cliOptionsTypes = (): Record<string, unknown> => ({});

export const shorthands: Record<string, string> = {};

export const commandNames = ['ci', 'clean-install', 'ic', 'install-clean'];

export function help(): string {
  return renderHelp({
    aliases: ['clean-install', 'ic', 'install-clean'],
    description: 'Clean install a project',
    descriptionLists: [],
    url: docsUrl('ci'),
    usages: ['pnpm ci'],
  });
}

export async function handler(_opts: unknown): Promise<never> {
  throw new PnpmError(
    'CI_NOT_IMPLEMENTED',
    'The ci command is not implemented yet'
  );
}
