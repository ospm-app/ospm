import { docsUrl } from '../packages/cli-utils/index.ts';
import { install } from '../packages/plugin-commands-installation/index.ts';
import { run } from '../packages/plugin-commands-script-runners/index.ts';
import renderHelp from 'render-help';
import type { OspmOptions } from '../types.ts';

export const cliOptionsTypes = install.cliOptionsTypes;

export const rcOptionsTypes = install.rcOptionsTypes;

export const commandNames = ['install-test', 'it'];

export function help(): string {
  return renderHelp({
    aliases: ['it'],
    description:
      'Runs a `ospm install` followed immediately by a `ospm test`. It takes exactly the same arguments as `ospm install`.',
    url: docsUrl('install-test'),
    usages: ['ospm install-test'],
  });
}

export async function handler(
  opts: OspmOptions,
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
