import type { Config } from '../config/index.ts';
import renderHelp from 'render-help';
import { getAutomaticallyIgnoredBuilds } from './getAutomaticallyIgnoredBuilds.ts';

export type IgnoredBuildsCommandOpts = Pick<
  Config,
  'modulesDir' | 'dir' | 'rootProjectManifest' | 'lockfileDir'
>;

export const commandNames = ['ignored-builds'];

export function help(): string {
  return renderHelp({
    description: 'Print the list of packages with blocked build scripts',
    usages: [],
  });
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export function rcOptionsTypes(): Record<string, unknown> {
  return {};
}

export async function handler(opts: IgnoredBuildsCommandOpts): Promise<string> {
  const ignoredBuiltDependencies =
    opts.rootProjectManifest?.ospm?.ignoredBuiltDependencies ?? [];

  const automaticallyIgnoredBuilds = (
    await getAutomaticallyIgnoredBuilds(opts)
  )?.filter((automaticallyIgnoredBuild: string): boolean => {
    return !ignoredBuiltDependencies.includes(automaticallyIgnoredBuild);
  });

  let output = 'Automatically ignored builds during installation:\n';

  if (automaticallyIgnoredBuilds == null) {
    output += '  Cannot identify as no node_modules found';
  } else if (automaticallyIgnoredBuilds.length === 0) {
    output += '  None';
  } else {
    output += `  ${automaticallyIgnoredBuilds.join('\n  ')}
hint: To allow the execution of build scripts for a package, add its name to "ospm.onlyBuiltDependencies" in your "package.json", then run "ospm rebuild".
hint: If you don't want to build a package, add it to the "ospm.ignoredBuiltDependencies" list.`;
  }

  output += '\n';

  if (ignoredBuiltDependencies.length) {
    output += `\nExplicitly ignored package builds (via ospm.ignoredBuiltDependencies):\n  ${ignoredBuiltDependencies.join('\n  ')}\n`;
  }

  return output;
}
