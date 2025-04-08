import type { Config } from '../config/index.ts';
import type { DependenciesField } from '../types/index.ts';

export function getSaveType(
  opts: Pick<Config, 'saveDev' | 'saveOptional' | 'saveProd' | 'savePeer'>
): DependenciesField | undefined {
  if (opts.saveDev === true || opts.savePeer === true) {
    return 'devDependencies';
  }

  if (opts.saveOptional === true) {
    return 'optionalDependencies';
  }

  if (opts.saveProd === true) {
    return 'dependencies';
  }

  return undefined;
}
