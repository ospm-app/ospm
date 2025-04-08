import { packageManifestLogger } from '../../core-loggers/index.ts';
import {
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  type ProjectManifest,
} from '../../types/index.ts';

export async function removeDeps(
  packageManifest: ProjectManifest,
  removedPackages: string[],
  opts: {
    saveType?: DependenciesField | undefined;
    prefix: string;
  }
): Promise<ProjectManifest> {
  if (opts.saveType) {
    if (packageManifest[opts.saveType] == null) {
      return packageManifest;
    }

    for (const dependency of removedPackages) {
      delete packageManifest[opts.saveType as DependenciesField]?.[dependency];
    }
  } else {
    for (const depField of DEPENDENCIES_FIELDS) {
      if (!packageManifest[depField]) {
        continue;
      }

      for (const dependency of removedPackages) {
        delete packageManifest[depField][dependency];
      }
    }
  }

  if (typeof packageManifest.peerDependencies !== 'undefined') {
    for (const removedDependency of removedPackages) {
      delete packageManifest.peerDependencies[removedDependency];
    }
  }

  if (typeof packageManifest.dependenciesMeta !== 'undefined') {
    for (const removedDependency of removedPackages) {
      delete packageManifest.dependenciesMeta[removedDependency];
    }
  }

  packageManifestLogger.debug({
    prefix: opts.prefix,
    updated: packageManifest,
  });

  return packageManifest;
}
