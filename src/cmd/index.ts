import { cache } from '../packages/cache.commands/index.ts';
import type { CompletionFunc } from '../packages/command/index.ts';
import { types as allTypes } from '../packages/config/types.ts';
import {
  approveBuilds,
  ignoredBuilds,
} from '../packages/exec.build-commands/index.ts';
import { audit } from '../packages/plugin-commands-audit/index.ts';
import {
  generateCompletion,
  createCompletionServer,
} from '../packages/plugin-commands-completion/index.ts';
import {
  config,
  getCommand,
  setCommand,
} from '../packages/plugin-commands-config/index.ts';
import { doctor } from '../packages/plugin-commands-doctor/index.ts';
import { env } from '../packages/plugin-commands-env/index.ts';
import { deploy } from '../packages/plugin-commands-deploy/index.ts';
import {
  add,
  ci,
  dedupe,
  fetch,
  install,
  link,
  prune,
  remove,
  unlink,
  update,
  importCommand,
} from '../packages/plugin-commands-installation/index.ts';
import { selfUpdate } from '../packages/tools.plugin-commands-self-updater/index.ts';
import { list, ll, why } from '../packages/plugin-commands-listing/index.ts';
import { licenses } from '../packages/plugin-commands-licenses/index.ts';
import { outdated } from '../packages/plugin-commands-outdated/index.ts';
import { pack, publish } from '../packages/plugin-commands-publishing/index.ts';
import {
  patch,
  patchCommit,
  patchRemove,
} from '../packages/plugin-commands-patching/index.ts';
import { rebuild } from '../packages/plugin-commands-rebuild/index.ts';
import {
  create,
  dlx,
  exec,
  restart,
  run,
} from '../packages/plugin-commands-script-runners/index.ts';
import { server } from '../packages/plugin-commands-server/index.ts';
import { setup } from '../packages/plugin-commands-setup/index.ts';
import { store } from '../packages/plugin-commands-store/index.ts';
import {
  catFile,
  catIndex,
  findHash,
} from '../packages/plugin-commands-store-inspecting/index.ts';
import { init } from '../packages/plugin-commands-init/index.ts';
import pick from 'ramda/src/pick';
import type { OspmOptions } from '../types.ts';
import { shorthands as universalShorthands } from '../shorthands.ts';
import { parseCliArgs } from '../parseCliArgs.ts';
import * as bin from './bin.ts';
import { createHelp } from './help.ts';
import * as installTest from './installTest.ts';
import * as recursive from './recursive.ts';
import * as root from './root.ts';

export const GLOBAL_OPTIONS = pick.default(
  [
    'color',
    'dir',
    'filter',
    'filter-prod',
    'loglevel',
    'parseable',
    'prefix',
    'reporter',
    'stream',
    'aggregate-output',
    'test-pattern',
    'changed-files-ignore-pattern',
    'use-stderr',
    'ignore-workspace',
    'workspace-packages',
    'workspace-root',
    'include-workspace-root',
    'fail-if-no-match',
  ],
  allTypes
);

export type CommandResponse = string | { output?: string; exitCode: number };

export type Command =
  | ((
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      opts: OspmOptions | any,
      params: string[]
    ) => CommandResponse | Promise<CommandResponse>)
  | ((opts: OspmOptions | any, params: string[]) => void) // eslint-disable-line @typescript-eslint/no-explicit-any
  | ((opts: OspmOptions | any, params: string[]) => Promise<void>); // eslint-disable-line @typescript-eslint/no-explicit-any

export type CommandDefinition = {
  /** The main logic of the command. */
  handler: Command;
  /** The help text for the command that describes its usage and options. */
  help: () => string;
  /** The names that will trigger this command handler. */
  commandNames: string[];
  /**
   * A function that returns an object whose keys are acceptable CLI options
   * for this command and whose values are the types of values
   * for these options for validation.
   */
  cliOptionsTypes: () => Record<string, unknown>;
  /**
   * A function that returns an object whose keys are acceptable options
   * in the .npmrc file for this command and whose values are the types of values
   * for these options for validation.
   */
  rcOptionsTypes: () => Record<string, unknown>;
  /** Auto-completion provider for this command. */
  completion?: CompletionFunc | undefined;
  /**
   * Option names that will resolve into one or more of the other options.
   *
   * Example:
   * ```ts
   * {
   *   D: '--dev',
   *   parallel: ['--no-sort', '--recursive'],
   * }
   * ```
   */
  shorthands?: Record<string, string | string[]> | undefined;
  /**
   * If true, this command should not care about what package manager is specified in the "packageManager" field of "package.json".
   */
  skipPackageManagerCheck?: boolean | undefined;
};

const commands: CommandDefinition[] = [
  add,
  approveBuilds,
  audit,
  bin,
  cache,
  ci,
  config,
  dedupe,
  getCommand,
  setCommand,
  create,
  deploy,
  dlx,
  doctor,
  env,
  exec,
  fetch,
  generateCompletion,
  ignoredBuilds,
  importCommand,
  selfUpdate,
  init,
  install,
  installTest,
  link,
  list,
  ll,
  licenses,
  outdated,
  pack,
  patch,
  patchCommit,
  patchRemove,
  prune,
  publish,
  rebuild,
  recursive,
  remove,
  restart,
  root,
  run,
  server,
  setup,
  store,
  catFile,
  catIndex,
  findHash,
  unlink,
  update,
  why,
];

const handlerByCommandName: Record<string, Command> = {};

const helpByCommandName: Record<string, () => string> = {};

const cliOptionsTypesByCommandName: Record<
  string,
  () => Record<string, unknown>
> = {};

const aliasToFullName = new Map<string, string>();

const completionByCommandName: Record<string, CompletionFunc> = {};

export const shorthandsByCommandName: Record<
  string,
  Record<string, string | string[]>
> = {};

export const rcOptionsTypes: Record<string, unknown> = {};

const skipPackageManagerCheckForCommandArray = ['completion-server'];

for (let i = 0; i < commands.length; i++) {
  const c = commands[i];

  if (typeof c === 'undefined') {
    throw new Error(`The command at index ${i} is undefined`);
  }

  const {
    cliOptionsTypes,
    commandNames,
    completion,
    handler,
    help,
    rcOptionsTypes,
    shorthands,
    skipPackageManagerCheck,
  } = c;

  if (commandNames.length === 0) {
    throw new Error(`The command at index ${i} doesn't have command names`);
  }

  for (const commandName of commandNames) {
    handlerByCommandName[commandName] = handler;

    helpByCommandName[commandName] = help;

    cliOptionsTypesByCommandName[commandName] = cliOptionsTypes;

    shorthandsByCommandName[commandName] = shorthands ?? {};

    if (completion != null) {
      completionByCommandName[commandName] = completion;
    }

    Object.assign(rcOptionsTypes, rcOptionsTypes());
  }

  if (skipPackageManagerCheck === true) {
    skipPackageManagerCheckForCommandArray.push(...commandNames);
  }

  if (commandNames.length > 1) {
    const fullName = commandNames[0];

    if (typeof fullName === 'undefined') {
      throw new Error(`The command name at index ${0} is undefined`);
    }

    for (let j = 1; j < commandNames.length; j++) {
      const cj = commandNames[j];

      if (typeof cj === 'undefined') {
        throw new Error(`The command name at index ${j} is undefined`);
      }

      aliasToFullName.set(cj, fullName);
    }
  }
}

handlerByCommandName.help = createHelp(helpByCommandName);

handlerByCommandName['completion-server'] = createCompletionServer({
  cliOptionsTypesByCommandName,
  completionByCommandName,
  initialCompletion,
  shorthandsByCommandName,
  universalOptionsTypes: GLOBAL_OPTIONS,
  universalShorthands,
  parseCliArgs,
});

function initialCompletion(): Array<{ name: string }> {
  return Object.keys(handlerByCommandName).map((name) => ({ name }));
}

export const ospmCmds = handlerByCommandName;

export const skipPackageManagerCheckForCommand = new Set(
  skipPackageManagerCheckForCommandArray
);

export function getCliOptionsTypes(
  commandName: string
): Record<string, unknown> {
  return cliOptionsTypesByCommandName[commandName]?.() || {};
}

export function getCommandFullName(commandName: string): string | null {
  return (
    aliasToFullName.get(commandName) ??
    (handlerByCommandName[commandName] ? commandName : null)
  );
}
