import { WorkspaceSpec } from '../workspace.spec-parser/index.ts';

export function workspacePrefToNpm(workspacePref: string): string {
  const parseResult = WorkspaceSpec.parse(workspacePref);

  if (parseResult == null) {
    throw new Error(`Invalid workspace spec: ${workspacePref}`);
  }

  const { alias, version } = parseResult;

  const versionPart = version === '^' || version === '~' ? '*' : version;

  return typeof alias === 'string'
    ? `npm:${alias}@${versionPart}`
    : versionPart;
}
