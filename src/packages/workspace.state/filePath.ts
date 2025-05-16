import path from 'node:path';

export function getFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, 'node_modules', '.ospm-workspace-state.json');
}
