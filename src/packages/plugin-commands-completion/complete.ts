import type { CompletionItem } from '@pnpm/tabtab';
import type { CompletionFunc } from '../command/index.ts';
import { findWorkspaceDir } from '../find-workspace-dir/index.ts';
import {
  findWorkspacePackages,
  type Project,
} from '../workspace.find-packages/index.ts';
import { readWorkspaceManifest } from '../workspace.read-manifest/index.ts';
import { getOptionCompletions } from './getOptionType.ts';
import { optionTypesToCompletions } from './optionTypesToCompletions.ts';

export async function complete(
  ctx: {
    cliOptionsTypesByCommandName: Record<string, () => Record<string, unknown>>;
    completionByCommandName: Record<string, CompletionFunc>;
    initialCompletion: () => CompletionItem[];
    shorthandsByCommandName: Record<string, Record<string, string | string[]>>;
    universalOptionsTypes: Record<string, unknown>;
    universalShorthands: Record<string, string>;
  },
  input: {
    params: string[];
    cmd: string | null;
    currentTypedWordType: 'option' | 'value' | null;
    lastOption: string | null;
    options: Record<string, unknown>;
  }
): Promise<CompletionItem[]> {
  if (typeof input.options.version !== 'undefined') {
    return [];
  }

  const optionTypes = {
    ...ctx.universalOptionsTypes,
    ...((input.cmd !== null &&
      ctx.cliOptionsTypesByCommandName[input.cmd]?.()) ??
      {}),
  };

  // Autocompleting option values
  if (input.currentTypedWordType !== 'option') {
    if (input.lastOption === '--filter') {
      const workspaceDir =
        (await findWorkspaceDir(process.cwd())) ?? process.cwd();

      const workspaceManifest = await readWorkspaceManifest(workspaceDir);

      const allProjects = await findWorkspacePackages(workspaceDir, {
        patterns: workspaceManifest?.packages,
        supportedArchitectures: {
          os: ['current'],
          cpu: ['current'],
          libc: ['current'],
        },
      });

      return allProjects
        .map(({ manifest }: Project): { name: string } => {
          return { name: manifest.name };
        })
        .filter(
          (item: {
            name: string;
          }): item is CompletionItem => {
            return !!item.name;
          }
        );
    }

    if (input.lastOption !== null) {
      const optionCompletions = getOptionCompletions(
        optionTypes,
        {
          ...ctx.universalShorthands,
          ...(input.cmd !== null ? ctx.shorthandsByCommandName[input.cmd] : {}),
        },
        input.lastOption
      );

      if (optionCompletions !== undefined) {
        return optionCompletions.map((name) => ({ name }));
      }
    }
  }

  let completions: CompletionItem[] = [];

  if (input.currentTypedWordType !== 'option') {
    if (
      input.cmd === null ||
      (input.currentTypedWordType === 'value' &&
        !ctx.completionByCommandName[input.cmd])
    ) {
      completions = ctx.initialCompletion();
    } else if (ctx.completionByCommandName[input.cmd]) {
      try {
        completions =
          (await ctx.completionByCommandName[input.cmd]?.(
            input.options,
            input.params
          )) ?? [];
      } catch {
        // Ignore
      }
    }
  }

  if (input.currentTypedWordType === 'value') {
    return completions;
  }

  if (input.cmd === null) {
    return [
      ...completions,
      ...optionTypesToCompletions(optionTypes),
      { name: '--version' },
    ];
  }

  return [
    ...completions,
    ...optionTypesToCompletions(optionTypes as any), // eslint-disable-line
  ];
}
