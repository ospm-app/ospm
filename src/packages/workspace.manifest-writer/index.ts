import path from 'node:path';
import {
  readWorkspaceManifest,
  type WorkspaceManifest,
} from '../workspace.read-manifest/index.ts';
import { WORKSPACE_MANIFEST_FILENAME } from '../constants/index.ts';
import writeYamlFile from 'write-yaml-file';

export async function updateWorkspaceManifest(
  dir: string,
  updatedFields: Partial<WorkspaceManifest>
): Promise<void> {
  const manifest = await readWorkspaceManifest(dir);

  await writeYamlFile(path.join(dir, WORKSPACE_MANIFEST_FILENAME), {
    ...manifest,
    ...updatedFields,
  });
}
