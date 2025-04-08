import { docsUrl } from '../packages/cli-utils/index.ts';
import { install } from '../packages/plugin-commands-installation/index.ts';
import { run } from '../packages/plugin-commands-script-runners/index.ts';
import renderHelp from 'render-help';
import type { PnpmOptions } from '../types.ts';

export const cliOptionsTypes = install.cliOptionsTypes;

export const rcOptionsTypes = install.rcOptionsTypes;

export const commandNames = ['install-test', 'it'];

export function help(): string {
  return renderHelp({
    aliases: ['it'],
    description:
      'Runs a `pnpm install` followed immediately by a `pnpm test`. It takes exactly the same arguments as `pnpm install`.',
    url: docsUrl('install-test'),
    usages: ['pnpm install-test'],
  });
}

export async function handler(
  opts: PnpmOptions,
  params: string[]
): Promise<void> {
  await install.handler({
    ...opts,
    recursive: opts.recursive ?? false,
  });

  await run.handler(
    {
      ...opts,
      recursive: true,
      allProjects: opts.allProjects ?? [],
      selectedProjectsGraph: opts.selectedProjectsGraph ?? {},
      workspaceDir: opts.workspaceDir,
    },
    ['test', ...params]
  );
}
