import renderHelp from 'render-help';
import { docsUrl } from '../cli-utils/index.ts';
import { getCompletionScript, SUPPORTED_SHELLS } from '@pnpm/tabtab';
import { getShellFromParams } from './getShell.ts';

export const commandNames = ['completion'];

export const skipPackageManagerCheck = true;

export const rcOptionsTypes = (): Record<string, unknown> => ({});

export const cliOptionsTypes = (): Record<string, unknown> => ({});

export function help(): string {
  return renderHelp({
    description: 'Print shell completion code to stdout',
    url: docsUrl('completion'),
    usages: SUPPORTED_SHELLS.map((shell) => `ospm completion ${shell}`),
  });
}

export type Context = {
  readonly log: (output: string) => void;
};

export type CompletionGenerator = (
  _opts: unknown,
  params: string[]
) => Promise<void>;

export function createCompletionGenerator(ctx: Context): CompletionGenerator {
  return async function handler(
    _opts: unknown,
    params: string[]
  ): Promise<void> {
    const shell = getShellFromParams(params);

    const output = await getCompletionScript({
      name: 'ospm',
      completer: 'ospm',
      shell,
    });

    ctx.log(output);
  };
}

export const handler: CompletionGenerator = createCompletionGenerator({
  // eslint-disable-next-line no-console
  log: console.log,
});
