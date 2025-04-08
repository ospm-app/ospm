import path from 'node:path';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { nameVerFromPkgSnapshot } from '../lockfile.utils/index.ts';
import {
  lockfileWalkerGroupImporterSteps,
  type LockfileWalkerStep,
} from '../lockfile.walker/index.ts';
import {
  detectDepTypes,
  type DepTypes,
  DepType,
} from '../lockfile.detect-dep-types/index.ts';
import type { DependenciesField, ProjectId } from '../types/index.ts';
import { safeReadProjectManifestOnly } from '../read-project-manifest/index.ts';
import mapValues from 'ramda/src/map';

export interface AuditNode {
  version?: string | undefined;
  integrity?: string | undefined;
  requires?: Record<string, string | undefined> | undefined;
  dependencies?: { [name: string]: AuditNode } | undefined;
  dev: boolean;
}

export type AuditTree = AuditNode & {
  name?: string | undefined;
  install: string[];
  remove: string[];
  metadata: unknown;
};

export async function lockfileToAuditTree(
  lockfile: LockfileObject,
  opts: {
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    lockfileDir: string;
  }
): Promise<AuditTree> {
  const importerWalkers = lockfileWalkerGroupImporterSteps(
    lockfile,
    Object.keys(lockfile.importers ?? {}) as ProjectId[],
    { include: opts.include }
  );

  const dependencies: Record<string, AuditNode> = {};

  const depTypes = detectDepTypes(lockfile);

  await Promise.all(
    importerWalkers.map(
      async (importerWalker: {
        importerId: string;
        step: LockfileWalkerStep;
      }): Promise<void> => {
        const importerDeps = lockfileToAuditNode(depTypes, importerWalker.step);

        // For some reason the registry responds with 500 if the keys in dependencies have slashes
        // see issue: https://github.com/pnpm/pnpm/issues/2848
        const depName = importerWalker.importerId.replace(/\//g, '__');

        const manifest = await safeReadProjectManifestOnly(
          path.join(opts.lockfileDir, importerWalker.importerId)
        );

        dependencies[depName] = {
          dependencies: importerDeps,
          dev: false,
          requires: toRequires(importerDeps),
          version: manifest?.version ?? '0.0.0',
        };
      }
    )
  );

  const auditTree: AuditTree = {
    name: undefined,
    version: undefined,
    dependencies,
    dev: false,
    install: [],
    integrity: undefined,
    metadata: {},
    remove: [],
    requires: toRequires(dependencies),
  };

  return auditTree;
}

function lockfileToAuditNode(
  depTypes: DepTypes,
  step: LockfileWalkerStep
): Record<string, AuditNode> {
  const dependencies: Record<string, AuditNode> = {};

  for (const { depPath, pkgSnapshot, next } of step.dependencies) {
    const { name, version } = nameVerFromPkgSnapshot(depPath, pkgSnapshot);

    const subdeps = lockfileToAuditNode(depTypes, next());

    const dep: AuditNode = {
      dev: depTypes[depPath] === DepType.DevOnly,
      integrity:
        typeof pkgSnapshot.resolution !== 'undefined' &&
        'integrity' in pkgSnapshot.resolution
          ? pkgSnapshot.resolution.integrity
          : undefined,
      version,
    };

    if (Object.keys(subdeps).length > 0) {
      dep.dependencies = subdeps;
      dep.requires = toRequires(subdeps);
    }

    dependencies[name] = dep;
  }

  return dependencies;
}

function toRequires(
  auditNodesByDepName: Record<string, AuditNode>
): Record<string, string | undefined> {
  return mapValues.default((auditNode: AuditNode): string | undefined => {
    return auditNode.version;
  }, auditNodesByDepName);
}
