import { docsUrl } from '../cli-utils/index.ts';
import { UNIVERSAL_OPTIONS } from '../common-cli-options-help/index.ts';
import renderHelp from 'render-help';
import { createProjectManifestWriter } from './createProjectManifestWriter.ts';
import * as install from './install.ts';

export const cliOptionsTypes = install.cliOptionsTypes;

export const rcOptionsTypes = install.rcOptionsTypes;

export const commandNames = ['unlink', 'dislink'];

export function help(): string {
  return renderHelp({
    aliases: ['dislink'],
    description:
      'Removes the link created by `ospm link` and reinstalls package if it is saved in `package.json`',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Unlink in every package found in subdirectories \
or in every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "ospm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          ...UNIVERSAL_OPTIONS,
        ],
      },
    ],
    url: docsUrl('unlink'),
    usages: ['ospm unlink (in package dir)', 'ospm unlink <pkg>...'],
  });
}

export async function handler(
  opts: install.InstallCommandOptions,
  params: string[]
): Promise<undefined | string> {
  if (!opts.rootProjectManifest?.ospm?.overrides) {
    return 'Nothing to unlink';
  }

  if (params.length === 0) {
    for (const selector in opts.rootProjectManifest.ospm.overrides) {
      if (
        opts.rootProjectManifest.ospm.overrides[selector]?.startsWith(
          'link:'
        ) === true
      ) {
        delete opts.rootProjectManifest.ospm.overrides[selector];
      }
    }
  } else {
    for (const selector in opts.rootProjectManifest.ospm.overrides) {
      if (
        opts.rootProjectManifest.ospm.overrides[selector]?.startsWith(
          'link:'
        ) === true &&
        params.includes(selector)
      ) {
        delete opts.rootProjectManifest.ospm.overrides[selector];
      }
    }
  }
  const writeProjectManifest = await createProjectManifestWriter(
    opts.rootProjectManifestDir
  );
  await writeProjectManifest(opts.rootProjectManifest);
  await install.handler(opts);
  return undefined;
}
