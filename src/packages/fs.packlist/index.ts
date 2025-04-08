import npmPacklist from 'npm-packlist';
import type { ProjectManifest } from '../types/index.ts';

export async function packlist(
  pkgDir: string,
  opts?:
    | {
        packageJsonCache?: Record<string, ProjectManifest> | undefined;
      }
    | undefined
): Promise<string[]> {
  const packageJsonCacheMap = opts?.packageJsonCache
    ? new Map(Object.entries(opts.packageJsonCache))
    : undefined;

  const files = await npmPacklist({
    path: pkgDir,
    packageJsonCache: packageJsonCacheMap as Map<
      string,
      string | { files: string[] }
    >,
  });
  // There's a bug in the npm-packlist version that we use,
  // it sometimes returns duplicates.
  // Related issue: https://github.com/pnpm/pnpm/issues/6997
  // Unfortunately, we cannot upgrade the library
  // newer versions of npm-packlist are very slow.
  return Array.from(new Set(files.map((file) => file.replace(/^\.[/\\]/, ''))));
}
