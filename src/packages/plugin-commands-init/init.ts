import fs from 'node:fs';
import path from 'node:path';
import { docsUrl } from '../cli-utils/index.ts';
import { packageManager } from '../cli-meta/index.ts';
import type { Config, UniversalOptions } from '../config/index.ts';
import { OspmError } from '../error/index.ts';
import { sortKeysByPriority } from '../object.key-sorting/index.ts';
import type { ProjectManifest } from '../types/index.ts';
import { writeProjectManifest } from '../write-project-manifest/index.ts';
import renderHelp from 'render-help';
import { parseRawConfig } from './utils.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export const commandNames = ['init'];

export function help(): string {
  return renderHelp({
    description: 'Create a package.json file',
    descriptionLists: [],
    url: docsUrl('init'),
    usages: ['ospm init'],
  });
}

export async function handler(
  opts: Pick<UniversalOptions, 'rawConfig'> &
    Pick<Config, 'cliOptions'> &
    Partial<Pick<Config, 'initPackageManager'>>,
  params?: string[] | undefined
): Promise<string> {
  if (typeof params !== 'undefined' && params.length > 0) {
    throw new OspmError(
      'INIT_ARG',
      'init command does not accept any arguments',
      {
        hint: `Maybe you wanted to run "ospm create ${params.join(' ')}"`,
      }
    );
  }

  // Using cwd instead of the dir option because the dir option
  // is set to the first parent directory that has a package.json file
  // But --dir option from cliOptions should be respected.
  const manifestPath = path.join(
    opts.cliOptions.dir ?? process.cwd(),
    'package.json'
  );

  if (fs.existsSync(manifestPath)) {
    throw new OspmError('PACKAGE_JSON_EXISTS', 'package.json already exists');
  }

  const manifest: ProjectManifest = {
    name: path.basename(process.cwd()),
    version: '1.0.0',
    description: '',
    main: 'index.js',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    keywords: [],
    author: '',
    license: 'ISC',
  };

  const config = await parseRawConfig(opts.rawConfig);

  const packageJson = { ...manifest, ...config };

  if (opts.initPackageManager === true) {
    packageJson.packageManager = `ospm@${packageManager.version}`;
  }

  const priority = Object.fromEntries(
    [
      'name',
      'version',
      'description',
      'main',
      'scripts',
      'keywords',
      'author',
      'license',
      'packageManager',
    ].map((key: string, index: number): [string, number] => {
      return [key, index];
    })
  );

  const sortedPackageJson = sortKeysByPriority({ priority }, packageJson);
  await writeProjectManifest(manifestPath, sortedPackageJson, {
    indent: 2,
  });
  return `Wrote to ${manifestPath}

${JSON.stringify(sortedPackageJson, null, 2)}`;
}
