import { OspmError } from '../error/index.ts';
import type { Catalogs } from '../catalogs.types/index.ts';
import type { WorkspaceManifest } from '../workspace.read-manifest/index.ts';

export function getCatalogsFromWorkspaceManifest(
  workspaceManifest: Pick<WorkspaceManifest, 'catalog' | 'catalogs'> | undefined
): Catalogs {
  // If the ospm-workspace.yaml file doesn't exist, no catalogs are defined.
  //
  // In some cases, it makes sense for callers to handle null/undefined checks
  // of this form. In this case, let's explicitly handle not found
  // ospm-workspace.yaml files by returning an empty catalog to make consuming
  // logic easier.
  if (workspaceManifest == null) {
    return {};
  }

  checkDefaultCatalogIsDefinedOnce(workspaceManifest);

  return {
    // If workspaceManifest.catalog is undefined, intentionally allow the spread
    // below to overwrite it. The check above ensures only one or the either is
    // defined.
    default: workspaceManifest.catalog,

    ...workspaceManifest.catalogs,
  };
}

export function checkDefaultCatalogIsDefinedOnce(
  manifest: Pick<WorkspaceManifest, 'catalog' | 'catalogs'>
): void {
  if (manifest.catalog != null && manifest.catalogs?.default != null) {
    throw new OspmError(
      'INVALID_CATALOGS_CONFIGURATION',
      "The 'default' catalog was defined multiple times. Use the 'catalog' field or 'catalogs.default', but not both."
    );
  }
}
