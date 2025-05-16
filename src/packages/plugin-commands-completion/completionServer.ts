import { type CompletionItem, getShellFromEnv } from '@pnpm/tabtab';
import type { CompletionFunc } from '../command/index.ts';
import { split as splitCmd } from 'split-cmd';
import tabtab from '@pnpm/tabtab';
import { currentTypedWordType, getLastOption } from './getOptionType.ts';
import type { ParsedCliArgs } from '../parse-cli-args/index.ts';
import { complete } from './complete.ts';
import process from 'node:process';

export function createCompletionServer(opts: {
  cliOptionsTypesByCommandName: Record<string, () => Record<string, unknown>>;
  completionByCommandName: Record<string, CompletionFunc>;
  initialCompletion: () => CompletionItem[];
  shorthandsByCommandName: Record<string, Record<string, string | string[]>>;
  parseCliArgs: (args: string[]) => Promise<ParsedCliArgs>;
  universalOptionsTypes: Record<string, unknown>;
  universalShorthands: Record<string, string>;
}): () => Promise<void> {
  return async () => {
    const shell = getShellFromEnv(process.env);

    const env = tabtab.parseEnv(process.env);

    if (!env.complete) {
      return;
    }

    // Parse only words that are before the pointer and finished.
    // Finished means that there's at least one space between the word and pointer
    const finishedArgv = env.partial.slice(0, -env.lastPartial.length);

    const inputArgv = splitCmd(finishedArgv).slice(1);

    // We cannot autocomplete what a user types after "ospm test --"
    if (inputArgv.includes('--') === true) {
      return;
    }

    const { params, options, cmd } = await opts.parseCliArgs(inputArgv);

    tabtab.log(
      await complete(opts, {
        cmd,
        currentTypedWordType: currentTypedWordType(env),
        lastOption: getLastOption(env),
        options,
        params,
      }),
      shell
    );
  };
}
