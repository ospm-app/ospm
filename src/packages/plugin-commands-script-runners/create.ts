import renderHelp from 'render-help';
import { docsUrl } from '../cli-utils/index.ts';
import { types } from '../config/types.ts';
import { OspmError } from '../error/index.ts';
import pick from 'ramda/src/pick';
import * as dlx from './dlx.ts';

export const commandNames = ['create'];

export async function handler(
  _opts: dlx.DlxCommandOptions,
  params: string[]
): Promise<{ exitCode: number }> {
  const [packageName, ...packageArgs] = params;
  if (packageName === undefined) {
    throw new OspmError(
      'MISSING_ARGS',
      'Missing the template package name.\n' +
        'The correct usage is `ospm create <name>` ' +
        'with <name> substituted for a package name.'
    );
  }

  const createPackageName = convertToCreateName(packageName);

  return dlx.handler(_opts, [createPackageName, ...packageArgs]);
}

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(['use-node-version'], types),
  };
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...rcOptionsTypes(),
    'allow-build': [String, Array],
  };
}

export function help(): string {
  return renderHelp({
    description: 'Creates a project from a `create-*` starter kit.',
    descriptionLists: [
      {
        title: 'Options',
        list: [
          {
            description:
              'A list of package names that are allowed to run postinstall scripts during installation',
            name: '--allow-build',
          },
        ],
      },
    ],
    url: docsUrl('create'),
    usages: [
      'ospm create <name>',
      'ospm create <name-without-create>',
      'ospm create <@scope>',
    ],
  });
}

const CREATE_PREFIX = 'create-';

/**
 * Defines the npm's algorithm for resolving a package name
 * for create-* packages.
 *
 * Example:
 *   - `foo`            -> `create-foo`
 *   - `@usr/foo`       -> `@usr/create-foo`
 *   - `@usr`           -> `@usr/create`
 *   - `@usr@2.0.0`     -> `@usr/create@2.0.0`
 *   - `@usr/foo@2.0.0` -> `@usr/create-foo@2.0.0`
 *   - `@usr@latest`    -> `@user/create@latest`
 *
 * For more info, see https://docs.npmjs.com/cli/v9/commands/npm-init#description
 */
function convertToCreateName(packageName: string): string {
  let newPackageName = packageName;

  if (newPackageName.startsWith('@')) {
    const preferredVersionPosition = newPackageName.indexOf('@', 1);

    let preferredVersion = '';

    if (preferredVersionPosition > -1) {
      preferredVersion = newPackageName.substring(preferredVersionPosition);

      newPackageName = newPackageName.substring(0, preferredVersionPosition);
    }

    const [scope, scopedPackage = ''] = newPackageName.split('/');

    if (scopedPackage === '') {
      return `${scope}/create${preferredVersion}`;
    }

    return `${scope}/${ensureCreatePrefixed(scopedPackage)}${preferredVersion}`;
  }

  return ensureCreatePrefixed(newPackageName);
}

function ensureCreatePrefixed(packageName: string): string {
  if (packageName.startsWith(CREATE_PREFIX)) {
    return packageName;
  }

  return `${CREATE_PREFIX}${packageName}`;
}
