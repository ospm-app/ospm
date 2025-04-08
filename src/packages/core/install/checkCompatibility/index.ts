import path from 'node:path';
import { LAYOUT_VERSION } from '../../../constants/index.ts';
import type { Modules } from '../../../modules-yaml/index.ts';
import { ModulesBreakingChangeError } from './ModulesBreakingChangeError.ts';
import { UnexpectedStoreError } from './UnexpectedStoreError.ts';
import { UnexpectedVirtualStoreDirError } from './UnexpectedVirtualStoreDirError.ts';
import type { ModulesDir } from 'src/packages/types/project.ts';

export function checkCompatibility(
  modules: Modules,
  opts: {
    storeDir: string;
    modulesDir: ModulesDir;
    virtualStoreDir: string;
  }
): void {
  if (!modules.layoutVersion || modules.layoutVersion !== LAYOUT_VERSION) {
    throw new ModulesBreakingChangeError({
      modulesPath: opts.modulesDir,
    });
  }

  // Important: comparing paths with path.relative()
  // is the only way to compare paths correctly on Windows
  // as of Node.js 4-9
  // See related issue: https://github.com/pnpm/pnpm/issues/996
  if (
    !modules.storeDir ||
    (path.relative(modules.storeDir, opts.storeDir) !== '' &&
      path.relative(modules.storeDir, path.join(opts.storeDir, '../v3')) !== '')
  ) {
    throw new UnexpectedStoreError({
      actualStorePath: opts.storeDir,
      expectedStorePath: modules.storeDir,
      modulesDir: opts.modulesDir,
    });
  }

  if (
    modules.virtualStoreDir &&
    path.relative(modules.virtualStoreDir, opts.virtualStoreDir) !== ''
  ) {
    throw new UnexpectedVirtualStoreDirError({
      actual: opts.virtualStoreDir,
      expected: modules.virtualStoreDir,
      modulesDir: opts.modulesDir,
    });
  }
}
