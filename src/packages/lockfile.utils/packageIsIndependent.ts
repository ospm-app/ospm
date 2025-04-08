import type { PackageSnapshot } from '../lockfile.types/index.ts';

export function packageIsIndependent({
  dependencies,
  optionalDependencies,
}: PackageSnapshot): boolean {
  return dependencies === undefined && optionalDependencies === undefined;
}
