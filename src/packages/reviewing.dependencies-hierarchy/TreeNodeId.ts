import type { DepPath } from '../types/index.ts';

export type TreeNodeId = TreeNodeIdImporter | TreeNodeIdPackage;

/**
 * A project local to the ospm workspace.
 */
type TreeNodeIdImporter = {
  readonly type: 'importer';
  readonly importerId: string;
};

/**
 * An npm package depended on externally.
 */
type TreeNodeIdPackage = {
  readonly type: 'package';
  readonly depPath: DepPath;
};

export function serializeTreeNodeId(treeNodeId: TreeNodeId): string {
  switch (treeNodeId.type) {
    case 'importer': {
      // Only serialize known fields from TreeNodeId. TypeScript is duck typed and
      // objects can have any number of unknown extra fields.
      const { type, importerId } = treeNodeId;

      return JSON.stringify({ type, importerId });
    }

    case 'package': {
      const { type, depPath } = treeNodeId;
      return JSON.stringify({ type, depPath });
    }
  }
}
