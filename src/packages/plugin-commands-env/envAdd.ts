import { OspmError } from '../error/index.ts';
import { downloadNodeVersion } from './downloadNodeVersion.ts';
import type { NvmNodeCommandOptions } from './node.ts';

export async function envAdd(
  opts: NvmNodeCommandOptions,
  params: string[]
): Promise<string> {
  if (opts.global !== true) {
    throw new OspmError(
      'NOT_IMPLEMENTED_YET',
      '"ospm env add <version>" can only be used with the "--global" option currently'
    );
  }

  const failed: string[] = [];

  for (const envSpecifier of params) {
    const result = await downloadNodeVersion(opts, envSpecifier);

    if (!result) {
      failed.push(envSpecifier);
    }
  }

  if (failed.length > 0) {
    throw new OspmError(
      'COULD_NOT_RESOLVE_NODEJS',
      `Couldn't find Node.js version matching ${failed.join(', ')}`
    );
  }

  return 'All specified Node.js versions were installed';
}
