import assert from 'node:assert';
import util from 'node:util';
import type { Config } from '../config/index.ts';
import { logger } from '../logger/index.ts';
import type {
  IncludedDependencies,
  LockFileDir,
  Project,
  ProjectRootDir,
} from '../types/index.ts';
import { render } from './list.ts';

export async function listRecursive(
  pkgs: Project[],
  params: string[],
  opts: Pick<Config, 'lockfileDir' | 'virtualStoreDirMaxLength'> & {
    depth?: number | undefined;
    include: IncludedDependencies;
    long?: boolean | undefined;
    parseable?: boolean | undefined;
    lockfileDir?: LockFileDir | undefined;
  }
): Promise<string> {
  const depth = opts.depth ?? 0;

  if (typeof opts.lockfileDir !== 'undefined' && opts.lockfileDir !== '') {
    return render(
      pkgs.map((pkg: Project): ProjectRootDir => {
        return pkg.rootDir;
      }),
      params,
      {
        ...opts,
        alwaysPrintRootPackage: depth === -1,
        lockfileDir: opts.lockfileDir,
      }
    );
  }

  const outputs = (
    await Promise.all(
      pkgs.map(async ({ rootDir }: Project): Promise<string> => {
        try {
          return await render([rootDir], params, {
            ...opts,
            alwaysPrintRootPackage: depth === -1,
            lockfileDir: opts.lockfileDir, // ?? rootDir,
          });
        } catch (err: unknown) {
          assert(util.types.isNativeError(err));

          const errWithPrefix = Object.assign(err, {
            prefix: rootDir,
          });

          logger.info(errWithPrefix);

          throw errWithPrefix;
        }
      })
    )
  ).filter(Boolean);

  if (outputs.length === 0) {
    return '';
  }

  const joiner = typeof depth === 'number' && depth > -1 ? '\n\n' : '\n';

  return outputs.join(joiner);
}
