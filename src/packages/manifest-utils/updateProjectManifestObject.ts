import { packageManifestLogger } from '../core-loggers/index.ts';
import {
  type DependenciesOrPeersField,
  type DependenciesField,
  DEPENDENCIES_FIELDS,
  DEPENDENCIES_OR_PEER_FIELDS,
  type ProjectManifest,
} from '../types/index.ts';

export interface PackageSpecObject {
  alias: string;
  nodeExecPath?: string | undefined;
  peer?: boolean | undefined;
  pref?: string | undefined;
  saveType?: DependenciesField | undefined;
}

export async function updateProjectManifestObject(
  prefix: string,
  packageManifest: ProjectManifest,
  packageSpecs: PackageSpecObject[]
): Promise<ProjectManifest> {
  for (const packageSpec of packageSpecs) {
    if (packageSpec.saveType) {
      const spec =
        packageSpec.pref ?? findSpec(packageSpec.alias, packageManifest);

      if (typeof spec === 'string') {
        packageManifest[packageSpec.saveType] =
          packageManifest[packageSpec.saveType] ?? {};

        const t = packageManifest[packageSpec.saveType];

        if (typeof t !== 'undefined') {
          t[packageSpec.alias] = spec;
        }

        for (const deptype of DEPENDENCIES_FIELDS) {
          if (deptype !== packageSpec.saveType) {
            delete packageManifest[deptype]?.[packageSpec.alias];
          }
        }

        if (packageSpec.peer === true) {
          packageManifest.peerDependencies =
            packageManifest.peerDependencies ?? {};
          packageManifest.peerDependencies[packageSpec.alias] = spec;
        }
      }
    } else if (typeof packageSpec.pref === 'string') {
      const usedDepType =
        guessDependencyType(packageSpec.alias, packageManifest) ??
        'dependencies';

      if (usedDepType !== 'peerDependencies') {
        packageManifest[usedDepType] = packageManifest[usedDepType] ?? {};

        packageManifest[usedDepType][packageSpec.alias] = packageSpec.pref;
      }
    }

    if (typeof packageSpec.nodeExecPath === 'string') {
      if (packageManifest.dependenciesMeta == null) {
        packageManifest.dependenciesMeta = {};
      }

      packageManifest.dependenciesMeta[packageSpec.alias] = {
        node: packageSpec.nodeExecPath,
      };
    }
  }

  packageManifestLogger.debug({
    prefix,
    updated: packageManifest,
  });
  return packageManifest;
}

function findSpec(
  alias: string,
  manifest: ProjectManifest
): string | undefined {
  const foundDepType = guessDependencyType(alias, manifest);

  return foundDepType && manifest[foundDepType]?.[alias];
}

export function guessDependencyType(
  alias: string,
  manifest: ProjectManifest
): DependenciesOrPeersField | undefined {
  return DEPENDENCIES_OR_PEER_FIELDS.find(
    (depField: DependenciesOrPeersField) => {
      return (
        manifest[depField]?.[alias] === '' ||
        Boolean(manifest[depField]?.[alias])
      );
    }
  );
}
