import renderHelp from 'render-help';
import { docsUrl } from '../cli-utils/index.ts';
import { logger } from '../logger/index.ts';
import type { Config } from '../config/index.ts';

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {};
}

export const shorthands = {};

export const commandNames = ['doctor'];

export function help(): string {
  return renderHelp({
    description: 'Checks for known common issues.',
    url: docsUrl('doctor'),
    usages: ['ospm doctor [options]'],
  });
}

export async function handler(
  opts: Pick<Config, 'failedToLoadBuiltInConfig'>
): Promise<void> {
  if (opts.failedToLoadBuiltInConfig) {
    // If true, means loading npm builtin config failed. Then there may have a prefix error, related: https://github.com/pnpm/pnpm/issues/5404
    logger.warn({
      message:
        'Load npm builtin configs failed. If the prefix builtin config does not work, you can use "ospm config list" to show builtin configs. And then use "ospm config --global set <key> <value>" to migrate configs from builtin to global.',
      prefix: process.cwd(),
    });
  }
}
