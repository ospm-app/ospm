import type { CliOptions } from '../config/index.ts';
import { PnpmError } from '../error/index.ts';
import { findWorkspaceDir } from '../find-workspace-dir/index.ts';
import nopt from '@pnpm/nopt';
import didYouMean, { ReturnTypeEnums } from 'didyoumean2';
import type { WorkspaceDir } from '../types/project.ts';

const RECURSIVE_CMDS = new Set(['recursive', 'multi', 'm']);

export type ParsedCliArgs = {
  argv: {
    remain: string[];
    cooked: string[];
    original: string[];
  };
  params: string[];
  options: CliOptions;
  cmd: string | null;
  unknownOptions: Map<string, string[]>;
  fallbackCommandUsed: boolean;
  workspaceDir: WorkspaceDir | undefined;
};

export async function parseCliArgs(
  opts: {
    escapeArgs?: string[] | undefined;
    fallbackCommand?: string | undefined;
    getCommandLongName: (commandName: string) => string | null;
    getTypesByCommandName: (commandName: string) => object;
    renamedOptions?: Record<string, string> | undefined;
    shorthandsByCommandName: Record<string, Record<string, string | string[]>>;
    universalOptionsTypes: Record<string, unknown>;
    universalShorthands: Record<string, string | string[]>;
  },
  inputArgv: string[]
): Promise<ParsedCliArgs> {
  const noptExploratoryResults = nopt(
    {
      filter: [String],
      help: Boolean,
      recursive: Boolean,
      ...opts.universalOptionsTypes,
      ...opts.getTypesByCommandName('add'),
      ...opts.getTypesByCommandName('install'),
    },
    {
      r: '--recursive',
      ...opts.universalShorthands,
    },
    inputArgv,
    0,
    { escapeArgs: opts.escapeArgs ?? [] }
  );

  const recursiveCommandUsed = RECURSIVE_CMDS.has(
    noptExploratoryResults.argv.remain[0] ?? ''
  );

  let commandName = getCommandName(noptExploratoryResults.argv.remain);

  let cmd = commandName ? opts.getCommandLongName(commandName) : null;

  const fallbackCommandUsed = Boolean(
    commandName && cmd === null && opts.fallbackCommand
  );

  if (fallbackCommandUsed) {
    cmd = opts.fallbackCommand ?? null;
    commandName = opts.fallbackCommand ?? '';
    inputArgv.unshift(opts.fallbackCommand ?? '');
    // The run command has special casing for --help and is handled further below.
  } else if (cmd !== 'run') {
    if (typeof noptExploratoryResults['help'] !== 'undefined') {
      return {
        ...getParsedArgsForHelp(),
        workspaceDir: await getWorkspaceDir(noptExploratoryResults),
      };
    }
    if (
      typeof noptExploratoryResults['version'] !== 'undefined' ||
      typeof noptExploratoryResults['v'] !== 'undefined'
    ) {
      return {
        argv: noptExploratoryResults.argv,
        cmd: null,
        options: {
          version: true,
        },
        params: noptExploratoryResults.argv.remain,
        unknownOptions: new Map(),
        fallbackCommandUsed: false,
        workspaceDir: await getWorkspaceDir(noptExploratoryResults),
      };
    }
  }

  function getParsedArgsForHelp(): Omit<ParsedCliArgs, 'workspaceDir'> {
    return {
      argv: noptExploratoryResults.argv,
      cmd: 'help',
      options: {},
      params: noptExploratoryResults.argv.remain,
      unknownOptions: new Map(),
      fallbackCommandUsed: false,
    };
  }

  const types = {
    ...opts.universalOptionsTypes,
    ...opts.getTypesByCommandName(commandName),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  function getCommandName(args: string[]): string {
    let newArgs = args;

    if (recursiveCommandUsed) {
      newArgs = newArgs.slice(1);
    }

    if (
      opts.getCommandLongName(newArgs[0] ?? 'add') !== 'install' ||
      newArgs.length === 1
    ) {
      return newArgs[0] ?? 'add';
    }

    return 'add';
  }

  function getEscapeArgsWithSpecialCaseForRun(): string[] | undefined {
    if (cmd !== 'run') {
      return opts.escapeArgs;
    }

    // We'd like everything after the run script's name to be passed to the
    // script's argv itself. For example, "pnpm run echo --test" should pass
    // "--test" to the "echo" script. This requires determining the script's
    // name and declaring it as the "escape arg".
    //
    // The name of the run script is normally the second argument (ex: pnpm
    // run foo), but can be pushed back by recursive commands (ex: pnpm
    // recursive run foo) or becomes the first argument when the fallback
    // command (ex: pnpm foo) is set to 'run'.
    const indexOfRunScriptName =
      1 +
      (recursiveCommandUsed ? 1 : 0) +
      (fallbackCommandUsed && opts.fallbackCommand === 'run' ? -1 : 0);

    return [noptExploratoryResults.argv.remain[indexOfRunScriptName] ?? ''];
  }

  const { argv, ...options } = nopt(
    {
      recursive: Boolean,
      ...types,
    },
    {
      ...opts.universalShorthands,
      ...opts.shorthandsByCommandName[commandName],
    },
    inputArgv,
    0,
    { escapeArgs: getEscapeArgsWithSpecialCaseForRun() ?? [] }
  );

  const workspaceDir = await getWorkspaceDir(options);

  // For the run command, it's not clear whether --help should be passed to the
  // underlying script or invoke pnpm's help text until an additional nopt call.
  if (cmd === 'run' && typeof options['help'] !== 'undefined') {
    return {
      ...getParsedArgsForHelp(),
      workspaceDir,
    };
  }

  if (opts.renamedOptions != null) {
    for (const [cliOption, optionValue] of Object.entries(options)) {
      if (typeof opts.renamedOptions[cliOption] !== 'undefined') {
        options[opts.renamedOptions[cliOption]] = optionValue;
        delete options[cliOption];
      }
    }
  }

  const params = argv.remain.slice(1);

  if (
    options['recursive'] !== true &&
    (typeof options['filter'] !== 'undefined' ||
      typeof options['filter-prod'] === 'undefined' ||
      recursiveCommandUsed)
  ) {
    options['recursive'] = true;

    const subCmd: string | null =
      typeof argv.remain[1] === 'string'
        ? opts.getCommandLongName(argv.remain[1])
        : null;

    if (subCmd !== null && recursiveCommandUsed) {
      params.shift();
      argv.remain.shift();
      cmd = subCmd;
    }
  }

  if (typeof options['workspace-root'] !== 'undefined') {
    if (typeof options['global'] !== 'undefined') {
      throw new PnpmError(
        'OPTIONS_CONFLICT',
        '--workspace-root may not be used with --global'
      );
    }

    if (typeof workspaceDir === 'undefined') {
      throw new PnpmError(
        'NOT_IN_WORKSPACE',
        '--workspace-root may only be used inside a workspace'
      );
    }

    options.dir = workspaceDir;
  }

  if (cmd === 'install' && params.length > 0) {
    cmd = 'add';
  } else if (cmd === null && typeof options['recursive'] !== 'undefined') {
    cmd = 'recursive';
  }

  const knownOptions = new Set(Object.keys(types));
  return {
    argv,
    cmd,
    params,
    workspaceDir,
    fallbackCommandUsed,
    ...normalizeOptions(options, knownOptions),
  };
}

const CUSTOM_OPTION_PREFIX = 'config.';

interface NormalizeOptionsResult {
  options: Record<string, unknown>;
  unknownOptions: Map<string, string[]>;
}

function normalizeOptions(
  options: Record<string, unknown>,
  knownOptions: Set<string>
): NormalizeOptionsResult {
  const standardOptionNames = [];
  const normalizedOptions: Record<string, unknown> = {};
  for (const [optionName, optionValue] of Object.entries(options)) {
    if (optionName.startsWith(CUSTOM_OPTION_PREFIX)) {
      normalizedOptions[optionName.substring(CUSTOM_OPTION_PREFIX.length)] =
        optionValue;
      continue;
    }
    normalizedOptions[optionName] = optionValue;
    standardOptionNames.push(optionName);
  }
  const unknownOptions = getUnknownOptions(standardOptionNames, knownOptions);
  return { options: normalizedOptions, unknownOptions };
}

function getUnknownOptions(
  usedOptions: string[],
  knownOptions: Set<string>
): Map<string, string[]> {
  const unknownOptions = new Map<string, string[]>();
  const closestMatches = getClosestOptionMatches.bind(
    null,
    Array.from(knownOptions)
  );
  for (const usedOption of usedOptions) {
    if (
      knownOptions.has(usedOption) ||
      usedOption.startsWith('//') ||
      isScopeRegistryOption(usedOption)
    )
      continue;

    unknownOptions.set(usedOption, closestMatches(usedOption));
  }
  return unknownOptions;
}

function isScopeRegistryOption(optionName: string): boolean {
  return /^@[\da-z][\w.-]*:registry$/.test(optionName);
}

function getClosestOptionMatches(
  knownOptions: string[],
  option: string
): string[] {
  return didYouMean(option, knownOptions, {
    returnType: ReturnTypeEnums.ALL_CLOSEST_MATCHES,
  });
}

async function getWorkspaceDir(
  parsedOpts: Record<string, WorkspaceDir>
): Promise<WorkspaceDir | undefined> {
  if (
    typeof parsedOpts['global'] !== 'undefined' ||
    typeof parsedOpts['ignore-workspace'] !== 'undefined'
  ) {
    return undefined;
  }

  const dir = parsedOpts.dir ?? process.cwd();

  return findWorkspaceDir(dir);
}
