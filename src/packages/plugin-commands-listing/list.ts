import { docsUrl } from '../cli-utils/index.ts';
import {
  FILTERING,
  OPTIONS,
  UNIVERSAL_OPTIONS,
} from '../common-cli-options-help/index.ts';
import { type Config, types as allTypes } from '../config/index.ts';
import { list, listForPackages } from '../list/index.ts';
import type {
  GlobalPkgDir,
  IncludedDependencies,
  LockFileDir,
  ModulesDir,
  Project,
  ProjectRootDir,
  ProjectRootDirRealPath,
  WorkspaceDir,
} from '../types/index.ts';
import pick from 'ramda/src/pick';
import renderHelp from 'render-help';
import { listRecursive } from './recursive.ts';

export function rcOptionsTypes(): Record<string, unknown> {
  return pick.default(
    [
      'depth',
      'dev',
      'global-dir',
      'global',
      'json',
      'long',
      'only',
      'optional',
      'parseable',
      'production',
    ],
    allTypes
  );
}

export const cliOptionsTypes = (): Record<string, unknown> => ({
  ...rcOptionsTypes(),
  'only-projects': Boolean,
  recursive: Boolean,
});

export const shorthands: Record<string, string> = {
  D: '--dev',
  P: '--production',
};

export const commandNames = ['list', 'ls'];

export function help(): string {
  return renderHelp({
    aliases: ['list', 'ls', 'la', 'll'],
    description:
      'When run as ll or la, it shows extended information by default. \
All dependencies are printed by default. Search by patterns is supported. \
For example: pnpm ls babel-* eslint-*',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Perform command on every package in subdirectories \
or on every workspace package, when executed inside a workspace. \
For options that may be used with `-r`, see "pnpm help recursive"',
            name: '--recursive',
            shortAlias: '-r',
          },
          {
            description: 'Show extended information',
            name: '--long',
          },
          {
            description: 'Show parseable output instead of tree view',
            name: '--parseable',
          },
          {
            description: 'Show information in JSON format',
            name: '--json',
          },
          {
            description:
              'List packages in the global install prefix instead of in the current project',
            name: '--global',
            shortAlias: '-g',
          },
          {
            description: 'Max display depth of the dependency tree',
            name: '--depth <number>',
          },
          {
            description: 'Display only direct dependencies',
            name: '--depth 0',
          },
          {
            description:
              'Display only projects. Useful in a monorepo. `pnpm ls -r --depth -1` lists all projects in a monorepo',
            name: '--depth -1',
          },
          {
            description:
              'Display only the dependency graph for packages in `dependencies` and `optionalDependencies`',
            name: '--prod',
            shortAlias: '-P',
          },
          {
            description:
              'Display only the dependency graph for packages in `devDependencies`',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description:
              'Display only dependencies that are also projects within the workspace',
            name: '--only-projects',
          },
          {
            description: "Don't display packages from `optionalDependencies`",
            name: '--no-optional',
          },
          OPTIONS.globalDir,
          ...UNIVERSAL_OPTIONS,
        ],
      },
      FILTERING,
    ],
    url: docsUrl('list'),
    usages: ['pnpm ls [<pkg> ...]'],
  });
}

export type ListCommandOptions = Pick<
  Config,
  | 'allProjects'
  | 'dev'
  | 'dir'
  | 'optional'
  | 'production'
  | 'selectedProjectsGraph'
  | 'modulesDir'
  | 'virtualStoreDirMaxLength'
> &
  Partial<Pick<Config, 'cliOptions'>> & {
    alwaysPrintRootPackage?: boolean | undefined;
    depth?: number | undefined;
    lockfileDir: LockFileDir;
    long?: boolean | undefined;
    parseable?: boolean | undefined;
    onlyProjects?: boolean | undefined;
    recursive?: boolean | undefined;
  };

export async function handler(
  opts: ListCommandOptions,
  params: string[]
): Promise<string> {
  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  const depth = opts.cliOptions?.['depth'] ?? 0;

  if (opts.recursive === true && opts.selectedProjectsGraph != null) {
    const pkgs = Object.values(opts.selectedProjectsGraph).map(
      (wsPkg: {
        dependencies: ProjectRootDir[];
        package: Project;
      }): Project => {
        return wsPkg.package;
      }
    );

    return listRecursive(pkgs, params, { ...opts, depth, include });
  }

  return render([opts.dir], params, {
    ...opts,
    depth,
    include,
    lockfileDir: opts.lockfileDir, // || opts.dir,
  });
}

export async function render(
  prefixes: (
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir
  )[],
  params: string[],
  opts: {
    alwaysPrintRootPackage?: boolean | undefined;
    depth?: number | undefined;
    include: IncludedDependencies;
    lockfileDir: string;
    long?: boolean | undefined;
    json?: boolean | undefined;
    onlyProjects?: boolean | undefined;
    parseable?: boolean | undefined;
    modulesDir?: ModulesDir | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<string> {
  const listOpts = {
    alwaysPrintRootPackage: opts.alwaysPrintRootPackage,
    depth: opts.depth ?? 0,
    include: opts.include,
    lockfileDir: opts.lockfileDir,
    long: opts.long,
    onlyProjects: opts.onlyProjects,
    reportAs: (opts.parseable === true
      ? 'parseable'
      : opts.json === true
        ? 'json'
        : 'tree') as 'parseable' | 'json' | 'tree',
    showExtraneous: false,
    modulesDir: opts.modulesDir,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
  };
  return params.length > 0
    ? listForPackages(params, prefixes, listOpts)
    : list(prefixes, listOpts);
}
