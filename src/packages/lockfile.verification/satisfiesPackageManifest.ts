import type { ProjectSnapshot } from '../lockfile.types/index.ts';
import { DEPENDENCIES_FIELDS, type ProjectManifest } from '../types/index.ts';
import equals from 'ramda/src/equals';
import pickBy from 'ramda/src/pickBy';
import omit from 'ramda/src/omit';

export function satisfiesPackageManifest(
  opts: {
    autoInstallPeers?: boolean | undefined;
    excludeLinksFromLockfile?: boolean | undefined;
  },
  importer: ProjectSnapshot | undefined,
  pkg: ProjectManifest
): { satisfies: boolean; detailedReason?: string | undefined } {
  if (typeof importer === 'undefined') {
    return { satisfies: false, detailedReason: 'no importer' };
  }

  let existingDeps: Record<string, string> = {
    ...pkg.devDependencies,
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  };

  let newPkg = pkg;

  if (opts.autoInstallPeers === true) {
    newPkg = {
      ...newPkg,
      dependencies: {
        ...(newPkg.peerDependencies &&
          omit.default(Object.keys(existingDeps), newPkg.peerDependencies)),
        ...newPkg.dependencies,
      },
    };

    existingDeps = {
      ...newPkg.peerDependencies,
      ...existingDeps,
    };
  }

  const pickNonLinkedDeps = pickBy.default((spec: string): boolean => {
    return !spec.startsWith('link:');
  });

  let specs = importer.specifiers;

  if (opts.excludeLinksFromLockfile === true) {
    existingDeps = pickNonLinkedDeps(existingDeps);

    specs = pickNonLinkedDeps(specs);
  }

  if (equals.default(existingDeps, specs) !== true) {
    return {
      satisfies: false,
      detailedReason: `specifiers in the lockfile (${JSON.stringify(specs)}) don't match specs in package.json (${JSON.stringify(existingDeps)})`,
    };
  }

  if (importer.publishDirectory !== newPkg.publishConfig?.directory) {
    return {
      satisfies: false,
      detailedReason: `"publishDirectory" in the lockfile (${importer.publishDirectory ?? 'undefined'}) doesn't match "publishConfig.directory" in package.json (${newPkg.publishConfig?.directory ?? 'undefined'})`,
    };
  }

  if (
    equals.default(
      newPkg.dependenciesMeta ?? {},
      importer.dependenciesMeta ?? {}
    ) !== true
  ) {
    return {
      satisfies: false,
      detailedReason: `importer dependencies meta (${JSON.stringify(importer.dependenciesMeta)}) doesn't match package manifest dependencies meta (${JSON.stringify(newPkg.dependenciesMeta)})`,
    };
  }

  for (const depField of DEPENDENCIES_FIELDS) {
    const importerDeps = importer[depField] ?? {};

    let pkgDeps: Record<string, string> = newPkg[depField] ?? {};

    if (opts.excludeLinksFromLockfile === true) {
      pkgDeps = pickNonLinkedDeps(pkgDeps);
    }

    let pkgDepNames: string[];

    switch (depField) {
      case 'optionalDependencies': {
        pkgDepNames = Object.keys(pkgDeps);

        break;
      }

      case 'devDependencies': {
        pkgDepNames = Object.keys(pkgDeps).filter(
          (depName: string): boolean => {
            return (
              typeof newPkg.optionalDependencies?.[depName] === 'undefined' &&
              typeof newPkg.dependencies?.[depName] === 'undefined'
            );
          }
        );

        break;
      }

      case 'dependencies': {
        pkgDepNames = Object.keys(pkgDeps).filter((depName): boolean => {
          return (
            typeof newPkg.optionalDependencies?.[depName] === 'undefined' &&
            typeof newPkg.dependencies?.[depName] === 'undefined'
          );
        });

        break;
      }

      default: {
        throw new Error(`Unknown dependency type "${depField as string}"`);
      }
    }

    if (
      pkgDepNames.length !== Object.keys(importerDeps).length &&
      pkgDepNames.length !== countOfNonLinkedDeps(importerDeps)
    ) {
      return {
        satisfies: false,
        detailedReason: `"${depField}" in the lockfile (${JSON.stringify(importerDeps)}) doesn't match the same field in package.json (${JSON.stringify(pkgDeps)})`,
      };
    }

    for (const depName of pkgDepNames) {
      if (
        typeof importerDeps[depName] === 'undefined' ||
        importer.specifiers[depName] !== pkgDeps[depName]
      ) {
        return {
          satisfies: false,
          detailedReason: `importer ${depField}.${depName} specifier ${importer.specifiers[depName]} don't match package manifest specifier (${pkgDeps[depName]})`,
        };
      }
    }
  }

  return { satisfies: true };
}

function countOfNonLinkedDeps(lockfileDeps: {
  [depName: string]: string;
}): number {
  return Object.values(lockfileDeps).filter(
    (ref) => !ref.includes('link:') && !ref.includes('file:')
  ).length;
}
