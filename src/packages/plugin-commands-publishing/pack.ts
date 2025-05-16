import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import type { Catalogs } from '../catalogs.types/index.ts';
import { OspmError } from '../error/index.ts';
import type {
  UniversalOptions,
  Config,
} from '../config/index.ts';
import {
  types as allTypes,
} from '../config/types.ts';
import { readProjectManifest } from '../cli-utils/index.ts';
import { createExportableManifest } from '../exportable-manifest/index.ts';
import { packlist } from '../fs.packlist/index.ts';
import { getBinsFromPackageManifest } from '../package-bins/index.ts';
import type { ProjectManifest, DependencyManifest } from '../types/index.ts';
import { glob } from 'tinyglobby';
import pick from 'ramda/src/pick';
import realpathMissing from 'realpath-missing';
import renderHelp from 'render-help';
import tar from 'tar-stream';
import { runScriptsIfPresent } from './publish.ts';
import chalk from 'chalk';
import validateNpmPackageName from 'validate-npm-package-name';

const LICENSE_GLOB = 'LICEN{S,C}E{,.*}'; // cspell:disable-line

export function rcOptionsTypes(): Record<string, unknown> {
  return {
    ...cliOptionsTypes(),
    ...pick.default(['npm-path'], allTypes),
  };
}

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    'pack-destination': String,
    out: String,
    ...pick.default(['pack-gzip-level', 'json'], allTypes),
  };
}

export const commandNames = ['pack'];

export function help(): string {
  return renderHelp({
    description: 'Create a tarball from a package',
    usages: ['ospm pack'],
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Directory in which `ospm pack` will save tarballs. The default is the current working directory.',
            name: '--pack-destination <dir>',
          },
          {
            description:
              'Prints the packed tarball and contents in the json format.',
            name: '--json',
          },
          {
            description:
              'Customizes the output path for the tarball. Use `%s` and `%v` to include the package name and version, e.g., `%s.tgz` or `some-dir/%s-%v.tgz`. By default, the tarball is saved in the current working directory with the name `<package-name>-<version>.tgz`.',
            name: '--out <path>',
          },
        ],
      },
    ],
  });
}

export type PackOptions = Pick<UniversalOptions, 'dir'> &
  Pick<
    Config,
    | 'catalogs'
    | 'ignoreScripts'
    | 'rawConfig'
    | 'embedReadme'
    | 'packGzipLevel'
    | 'nodeLinker'
  > &
  Partial<Pick<Config, 'extraBinPaths' | 'extraEnv'>> & {
    argv: {
      original: string[];
    };
    engineStrict?: boolean | undefined;
    packDestination?: string | undefined;
    out?: string | undefined;
    workspaceDir?: string | undefined;
    json?: boolean | undefined;
  };

export async function handler(opts: PackOptions): Promise<string> {
  const { publishedManifest, tarballPath, contents } = await api(opts);
  if (opts.json === true) {
    return JSON.stringify(
      {
        name: publishedManifest.name,
        version: publishedManifest.version,
        filename: tarballPath,
        files: contents.map((path) => ({ path })),
      },
      null,
      2
    );
  }
  return `${chalk.blueBright('Tarball Contents')}
${contents.join('\n')}

${chalk.blueBright('Tarball Details')}
${tarballPath}`;
}

export async function api(opts: PackOptions): Promise<PackResult> {
  const { manifest: entryManifest, fileName: manifestFileName } =
    await readProjectManifest(opts.dir, opts);

  preventBundledDependenciesWithoutHoistedNodeLinker(
    opts.nodeLinker,
    entryManifest
  );

  const _runScriptsIfPresent = runScriptsIfPresent.bind(null, {
    depPath: opts.dir,
    extraBinPaths: opts.extraBinPaths,
    extraEnv: opts.extraEnv,
    pkgRoot: opts.dir,
    rawConfig: opts.rawConfig,
    rootModulesDir: await realpathMissing(path.join(opts.dir, 'node_modules')),
    stdio: 'inherit',
    unsafePerm: true, // when running scripts explicitly, assume that they're trusted.
  });

  if (opts.ignoreScripts !== true) {
    await _runScriptsIfPresent(['prepack', 'prepare'], entryManifest);
  }

  const dir =
    typeof entryManifest.publishConfig?.directory === 'undefined'
      ? opts.dir
      : path.join(opts.dir, entryManifest.publishConfig.directory);

  // always read the latest manifest, as "prepack" or "prepare" script may modify package manifest.
  const { manifest } = await readProjectManifest(dir, opts);

  preventBundledDependenciesWithoutHoistedNodeLinker(opts.nodeLinker, manifest);

  if (!manifest.name) {
    throw new OspmError(
      'PACKAGE_NAME_NOT_FOUND',
      `Package name is not defined in the ${manifestFileName}.`
    );
  }

  if (!validateNpmPackageName(manifest.name).validForOldPackages) {
    throw new OspmError(
      'INVALID_PACKAGE_NAME',
      `Invalid package name "${manifest.name}".`
    );
  }

  if (!manifest.version) {
    throw new OspmError(
      'PACKAGE_VERSION_NOT_FOUND',
      `Package version is not defined in the ${manifestFileName}.`
    );
  }

  let tarballName: string;

  let packDestination: string | undefined;

  const normalizedName = manifest.name.replace('@', '').replace('/', '-');

  if (typeof opts.out === 'string') {
    if (typeof opts.packDestination === 'string') {
      throw new OspmError(
        'INVALID_OPTION',
        'Cannot use --pack-destination and --out together'
      );
    }

    const preparedOut = opts.out
      .replaceAll('%s', normalizedName)
      .replaceAll('%v', manifest.version);

    const parsedOut = path.parse(preparedOut);

    packDestination = parsedOut.dir ? parsedOut.dir : opts.packDestination;

    tarballName = parsedOut.base;
  } else {
    tarballName = `${normalizedName}-${manifest.version}.tgz`;

    packDestination = opts.packDestination;
  }

  const publishManifest = await createPublishManifest({
    projectDir: dir,
    modulesDir: path.join(opts.dir, 'node_modules'),
    manifest,
    embedReadme: opts.embedReadme,
    catalogs: opts.catalogs ?? {},
  });

  const files = await packlist(dir, {
    packageJsonCache: {
      [path.join(dir, 'package.json')]: publishManifest,
    },
  });

  const filesMap = Object.fromEntries(
    files.map((file: string): [string, string] => {
      return [`package/${file}`, path.join(dir, file)];
    })
  );

  if (
    opts.workspaceDir != null &&
    dir !== opts.workspaceDir &&
    !files.some((file) => /licen[cs]e(?:\..+)?/i.test(file))
  ) {
    const licenses = await glob([LICENSE_GLOB], {
      cwd: opts.workspaceDir,
      expandDirectories: false,
    });

    for (const license of licenses) {
      filesMap[`package/${license}`] = path.join(opts.workspaceDir, license);
    }
  }

  const destDir =
    typeof packDestination === 'string'
      ? path.isAbsolute(packDestination)
        ? packDestination
        : path.join(dir, packDestination || '.')
      : dir;

  await fs.promises.mkdir(destDir, { recursive: true });

  await packPkg({
    destFile: path.join(destDir, tarballName),
    filesMap,
    modulesDir: path.join(opts.dir, 'node_modules'),
    packGzipLevel: opts.packGzipLevel,
    manifest: publishManifest,
    bins: [
      ...(
        await getBinsFromPackageManifest(
          publishManifest as DependencyManifest,
          dir
        )
      ).map(({ path }) => path),
      ...(manifest.publishConfig?.executableFiles ?? []).map((executableFile) =>
        path.join(dir, executableFile)
      ),
    ],
  });

  if (opts.ignoreScripts !== true) {
    await _runScriptsIfPresent(['postpack'], entryManifest);
  }

  const packedTarballPath =
    opts.dir === destDir
      ? path.relative(opts.dir, path.join(dir, tarballName))
      : path.join(destDir, tarballName);

  const packedContents = files.sort((a: string, b: string): number => {
    return a.localeCompare(b, 'en');
  });

  return {
    publishedManifest: publishManifest,
    contents: packedContents,
    tarballPath: packedTarballPath,
  };
}

export type PackResult = {
  publishedManifest: ProjectManifest;
  contents: string[];
  tarballPath: string;
};

function preventBundledDependenciesWithoutHoistedNodeLinker(
  nodeLinker: Config['nodeLinker'],
  manifest: ProjectManifest
): void {
  if (nodeLinker === 'hoisted') {
    return;
  }

  for (const key of ['bundledDependencies', 'bundleDependencies'] as const) {
    const bundledDependencies = manifest[key];

    if (typeof bundledDependencies !== 'undefined') {
      throw new OspmError(
        'BUNDLED_DEPENDENCIES_WITHOUT_HOISTED',
        `${key} does not work with node-linker=${nodeLinker}`,
        {
          hint: `Add node-linker=hoisted to .npmrc or delete ${key} from the root package.json to resolve this error`,
        }
      );
    }
  }
}

async function readReadmeFile(projectDir: string): Promise<string | undefined> {
  const files = await fs.promises.readdir(projectDir);

  const readmePath = files.find((name: string): boolean => {
    return /readme\.md$/i.test(name);
  });

  return typeof readmePath === 'string'
    ? await fs.promises.readFile(path.join(projectDir, readmePath), 'utf8')
    : undefined;
}

async function packPkg(opts: {
  destFile: string;
  filesMap: Record<string, string>;
  modulesDir: string;
  packGzipLevel?: number | undefined;
  bins: string[];
  manifest: ProjectManifest;
}): Promise<void> {
  const { destFile, filesMap, bins, manifest } = opts;

  const mtime = new Date('1985-10-26T08:15:00.000Z');

  const pack = tar.pack();

  await Promise.all(
    Object.entries(filesMap).map(
      async ([name, source]: [string, string]): Promise<void> => {
        const isExecutable = bins.some((bin: string): boolean => {
          return path.relative(bin, source) === '';
        });

        const mode = isExecutable ? 0o7_5_5 : 0o6_4_4;

        if (/^package\/package\.(?:json|json5|yaml)$/.test(name)) {
          pack.entry(
            { mode, mtime, name: 'package/package.json' },
            JSON.stringify(manifest, null, 2)
          );

          return;
        }

        pack.entry({ mode, mtime, name }, fs.readFileSync(source));
      }
    )
  );

  const tarball = fs.createWriteStream(destFile);

  pack.pipe(createGzip({ level: opts.packGzipLevel })).pipe(tarball);

  pack.finalize();

  return new Promise((resolve, reject): void => {
    tarball
      .on('close', (): void => {
        resolve();
      })
      .on('error', reject);
  });
}

async function createPublishManifest(opts: {
  projectDir: string;
  embedReadme?: boolean | undefined;
  modulesDir: string;
  manifest: ProjectManifest;
  catalogs: Catalogs;
}): Promise<ProjectManifest> {
  const { projectDir, embedReadme, modulesDir, manifest, catalogs } = opts;

  const readmeFile =
    embedReadme === true ? await readReadmeFile(projectDir) : undefined;

  return createExportableManifest(projectDir, manifest, {
    catalogs,
    readmeFile,
    modulesDir,
  });
}
