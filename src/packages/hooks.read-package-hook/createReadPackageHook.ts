import { packageExtensions as compatPackageExtensions } from '@yarnpkg/extensions';
import type {
  LockFileDir,
  PackageExtension,
  PackageManifest,
  ProjectManifest,
  ReadPackageHook,
} from '../types/index.ts';
import isEmpty from 'ramda/src/isEmpty';
import pipeWith from 'ramda/src/pipeWith';
import { createOptionalDependenciesRemover } from './createOptionalDependenciesRemover.ts';
import { createPackageExtender } from './createPackageExtender.ts';
import { createVersionsOverrider } from './createVersionsOverrider.ts';
import type { PackageSelector } from '../parse-overrides/index.ts';

export function createReadPackageHook({
  ignoreCompatibilityDb,
  lockfileDir,
  overrides,
  ignoredOptionalDependencies,
  packageExtensions,
  readPackageHook,
}: {
  ignoreCompatibilityDb?: boolean | undefined;
  lockfileDir?: LockFileDir | undefined;
  overrides?:
    | (
        | {
            parentPkg: PackageSelector;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
        | {
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
      )[]
    | undefined;
  ignoredOptionalDependencies?: string[] | undefined;
  packageExtensions?: Record<string, PackageExtension> | undefined;
  readPackageHook?: ReadPackageHook[] | ReadPackageHook | undefined;
}): ReadPackageHook | undefined {
  const hooks: ReadPackageHook[] = [];

  if (ignoreCompatibilityDb !== true) {
    hooks.push(
      createPackageExtender(Object.fromEntries(compatPackageExtensions))
    );
  }

  if (
    typeof packageExtensions !== 'undefined' &&
    !isEmpty.default(packageExtensions)
  ) {
    hooks.push(createPackageExtender(packageExtensions));
  }

  if (Array.isArray(readPackageHook)) {
    hooks.push(...readPackageHook);
  } else if (readPackageHook) {
    hooks.push(readPackageHook);
  }

  if (
    typeof overrides !== 'undefined' &&
    typeof lockfileDir !== 'undefined' &&
    !isEmpty.default(overrides)
  ) {
    hooks.push(createVersionsOverrider(overrides, lockfileDir));
  }

  if (
    ignoredOptionalDependencies &&
    !isEmpty.default(ignoredOptionalDependencies)
  ) {
    hooks.push(createOptionalDependenciesRemover(ignoredOptionalDependencies));
  }

  if (hooks.length === 0) {
    return undefined;
  }

  const readPackageAndExtend: ReadPackageHook | undefined =
    hooks.length === 1
      ? hooks[0]
      : (((pkg: PackageManifest | ProjectManifest, dir: string) => {
          return pipeWith.default(async (f, res) => {
            return f(await res, dir);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }, hooks as any)(pkg, dir);
        }) as ReadPackageHook);

  return readPackageAndExtend;
}
