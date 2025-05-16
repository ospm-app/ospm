import { refToRelative } from '../dependency-path/index.ts';
import path from 'node:path';
import { getLockfileImporterId } from '../lockfile.fs/index.ts';
import type { TreeNodeId } from './TreeNodeId.ts';
import type { ProjectSnapshot } from '../lockfile.types/index.ts';

export type getTreeNodeChildIdOpts = {
  readonly parentId: TreeNodeId;
  readonly dep: {
    readonly alias: string;
    readonly ref: string;
  };
  readonly lockfileDir: string;
  readonly importers: Record<string, ProjectSnapshot>;
};

export function getTreeNodeChildId(
  opts: getTreeNodeChildIdOpts
): TreeNodeId | undefined {
  const depPath = refToRelative(opts.dep.ref, opts.dep.alias);

  if (depPath !== null) {
    return { type: 'package', depPath };
  }

  switch (opts.parentId.type) {
    case 'importer': {
      // This should be a link given depPath is null.
      //
      // TODO: Consider updating refToRelative (or writing a new function) to
      // return an enum so there's no implicit assumptions.
      const linkValue = opts.dep.ref.slice('link:'.length);

      // It's a bit roundabout to prepend the lockfile dir only to remove it
      // through getLockfileImporterId, but we can be more certain the right
      // importerId is created by reusing the getLockfileImporterId function.
      const absoluteLinkedPath = path.join(
        opts.lockfileDir,
        opts.parentId.importerId,
        linkValue
      );
      const childImporterId = getLockfileImporterId(
        opts.lockfileDir,
        absoluteLinkedPath
      );

      // A 'link:' reference may refer to a package outside of the ospm workspace.
      // Return undefined in that case since it would be difficult to list/traverse
      // that package outside of the ospm workspace.
      const isLinkOutsideWorkspace = opts.importers[childImporterId] == null;

      return isLinkOutsideWorkspace
        ? undefined
        : { type: 'importer', importerId: childImporterId };
    }

    case 'package':
      // In theory an external package could be overridden to link to a
      // dependency in the ospm workspace. Avoid traversing through this
      // edge case for now.
      return undefined;
  }
}
