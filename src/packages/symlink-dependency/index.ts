import path from 'node:path';
import { linkLogger } from '../core-loggers/index.ts';
import symlinkDir from 'symlink-dir';

export { symlinkDirectRootDependency } from './symlinkDirectRootDependency.ts';

export async function symlinkDependency(
  dependencyRealLocation: string,
  destModulesDir: string,
  importAs: string
): Promise<{ reused: boolean; warn?: string | undefined }> {
  const link = path.join(destModulesDir, importAs);

  linkLogger.debug({ target: dependencyRealLocation, link });

  return symlinkDir(dependencyRealLocation, link);
}

export function symlinkDependencySync(
  dependencyRealLocation: string,
  destModulesDir: string,
  importAs: string
): { reused: boolean; warn?: string | undefined } {
  const link = path.join(destModulesDir, importAs);

  linkLogger.debug({ target: dependencyRealLocation, link });

  return symlinkDir.sync(dependencyRealLocation, link);
}
