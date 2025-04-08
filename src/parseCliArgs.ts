import {
  type ParsedCliArgs,
  parseCliArgs as parseCliArgsLib,
} from './packages/parse-cli-args/index.ts';
import {
  getCliOptionsTypes,
  getCommandFullName,
  GLOBAL_OPTIONS,
  shorthandsByCommandName,
} from './cmd/index.ts';
import { shorthands as universalShorthands } from './shorthands.ts';

const RENAMED_OPTIONS = {
  'lockfile-directory': 'lockfile-dir',
  prefix: 'dir',
  'shrinkwrap-directory': 'lockfile-dir',
  store: 'store-dir',
};

export async function parseCliArgs(
  inputArgv: string[]
): Promise<ParsedCliArgs> {
  return parseCliArgsLib(
    {
      fallbackCommand: 'run',
      escapeArgs: ['create', 'dlx', 'exec', 'test'],
      getCommandLongName: getCommandFullName,
      getTypesByCommandName: getCliOptionsTypes,
      renamedOptions: RENAMED_OPTIONS,
      shorthandsByCommandName,
      universalOptionsTypes: GLOBAL_OPTIONS,
      universalShorthands,
    },
    inputArgv
  );
}
