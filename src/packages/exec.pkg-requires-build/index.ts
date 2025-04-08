import type { DependencyManifest } from '../types/index.ts';

export type PartialUndefined<T> = { [P in keyof T]?: T[P] | undefined };

export function pkgRequiresBuild(
  manifest: PartialUndefined<DependencyManifest> | undefined,
  filesIndex: Record<string, unknown>
): boolean {
  return Boolean(
    (manifest?.scripts != null &&
      (Boolean(manifest.scripts.preinstall) ||
        Boolean(manifest.scripts.install) ||
        Boolean(manifest.scripts.postinstall))) ||
      filesIncludeInstallScripts(filesIndex)
  );
}

function filesIncludeInstallScripts(
  filesIndex: Record<string, unknown>
): boolean {
  return (
    filesIndex['binding.gyp'] != null ||
    Object.keys(filesIndex).some(
      (filename) => filename.match(/^\.hooks[/\\]/) !== null
    )
  ); // TODO: optimize this
}
