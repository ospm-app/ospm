import type { DependenciesHierarchy } from '../reviewing.dependencies-hierarchy/index.ts';

export interface PackageDependencyHierarchy extends DependenciesHierarchy {
  name?: string | undefined;
  version?: string | undefined;
  path: string;
  private?: boolean | undefined;
}
