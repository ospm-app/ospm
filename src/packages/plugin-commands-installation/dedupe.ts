import { docsUrl } from '../cli-utils/index.ts';
import {
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { dedupeDiffCheck } from '../dedupe.check/index.ts';
import { prepareExecutionEnv } from '../plugin-commands-env/index.ts';
import renderHelp from 'render-help';
import {
  type InstallCommandOptions,
  rcOptionsTypes as installCommandRcOptionsTypes,
} from './install.ts';
import { installDeps } from './installDeps.ts';
import omit from 'ramda/src/omit';

// In general, the "ospm dedupe" command should use .npmrc options that "ospm install" would also accept.
export function rcOptionsTypes(): Record<string, unknown> {
  // Some options on ospm install (like --frozen-lockfile) don't make sense on ospm dedupe.
  return omit.default(['frozen-lockfile'], installCommandRcOptionsTypes());
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
    check: Boolean,
  };
}

export const commandNames = ['dedupe'];

export function help(): string {
  return renderHelp({
    description:
      'Perform an install removing older dependencies in the lockfile if a newer version can be used.',
    descriptionLists: [
      {
        title: 'Options',
        list: [
          ...UNIVERSAL_OPTIONS,
          {
            description:
              'Check if running dedupe would result in changes without installing packages or editing the lockfile. Exits with a non-zero status code if changes are possible.',
            name: '--check',
          },
          OPTIONS.ignoreScripts,
          OPTIONS.offline,
          OPTIONS.preferOffline,
          OPTIONS.storeDir,
          OPTIONS.virtualStoreDir,
          OPTIONS.globalDir,
        ],
      },
    ],
    url: docsUrl('dedupe'),
    usages: ['ospm dedupe'],
  });
}

export interface DedupeCommandOptions extends InstallCommandOptions {
  readonly check?: boolean | undefined;
}

export async function handler(opts: DedupeCommandOptions): Promise<void> {
  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  return installDeps(
    {
      ...opts,
      dedupe: true,
      include,
      includeDirect: include,
      lockfileCheck: opts.check === true ? dedupeDiffCheck : undefined,
      prepareExecutionEnv: prepareExecutionEnv.bind(null, opts),
    },
    []
  );
}
