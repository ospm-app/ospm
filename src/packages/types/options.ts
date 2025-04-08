import type { DependenciesField } from './misc.ts';
import type { PackageManifest } from './package.ts';

export type LogBase =
  | {
      level: 'debug' | 'error';
    }
  | {
      level: 'info' | 'warn';
      prefix: string;
      message: string;
    };

export type IncludedDependencies = {
  [dependenciesField in DependenciesField]: boolean;
};

export type ReadPackageHook = (
  pkg: PackageManifest,
  dir?: string | undefined
) => PackageManifest | Promise<PackageManifest>;
