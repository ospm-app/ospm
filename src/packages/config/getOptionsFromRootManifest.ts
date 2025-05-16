import path from 'node:path';
import { OspmError } from '../error/index.ts';
import type {
  SupportedArchitectures,
  AllowedDeprecatedVersions,
  PackageExtension,
  PeerDependencyRules,
  ProjectManifest,
  OspmSettings,
  LockFileDir,
  ProjectRootDir,
  ProjectRootDirRealPath,
  GlobalPkgDir,
  WorkspaceDir,
} from '../types/index.ts';
import mapValues from 'ramda/src/map';
import pick from 'ramda/src/pick';

export type OptionsFromRootManifest = {
  allowedDeprecatedVersions?: AllowedDeprecatedVersions | undefined;
  allowNonAppliedPatches?: boolean | undefined;
  overrides?: Record<string, string> | undefined;
  neverBuiltDependencies?: string[] | undefined;
  onlyBuiltDependencies?: string[] | undefined;
  onlyBuiltDependenciesFile?: string | undefined;
  ignoredBuiltDependencies?: string[] | undefined;
  packageExtensions?: Record<string, PackageExtension> | undefined;
  ignoredOptionalDependencies?: string[] | undefined;
  patchedDependencies?: Record<string, string> | undefined;
  peerDependencyRules?: PeerDependencyRules | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
} & Pick<OspmSettings, 'configDependencies'>;

export function getOptionsFromRootManifest(
  manifestDir:
    | LockFileDir
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir,
  manifest?: ProjectManifest | undefined
): OptionsFromRootManifest {
  const settings: OptionsFromRootManifest = getOptionsFromOspmSettings(
    manifestDir,
    {
      ...pick.default(
        [
          'allowNonAppliedPatches',
          'allowedDeprecatedVersions',
          'configDependencies',
          'ignoredBuiltDependencies',
          'ignoredOptionalDependencies',
          'neverBuiltDependencies',
          'onlyBuiltDependencies',
          'onlyBuiltDependenciesFile',
          'overrides',
          'packageExtensions',
          'patchedDependencies',
          'peerDependencyRules',
          'supportedArchitectures',
        ],
        manifest?.ospm ?? {}
      ),
      // We read Yarn's resolutions field for compatibility
      // but we really replace the version specs to any other version spec, not only to exact versions,
      // so we cannot call it resolutions
      overrides: {
        ...manifest?.resolutions,
        ...manifest?.ospm?.overrides,
      },
    },
    manifest
  );

  return settings;
}

export function getOptionsFromOspmSettings(
  manifestDir: string,
  ospmSettings: OspmSettings,
  manifest?: ProjectManifest | undefined
): OptionsFromRootManifest {
  const settings: OptionsFromRootManifest = { ...ospmSettings };

  if (typeof settings.overrides !== 'undefined') {
    if (Object.keys(settings.overrides).length === 0) {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete settings.overrides;
    } else if (typeof manifest !== 'undefined') {
      settings.overrides = mapValues.default(
        createVersionReferencesReplacer(manifest),
        settings.overrides
      );
    }
  }

  if (typeof ospmSettings.onlyBuiltDependenciesFile === 'string') {
    settings.onlyBuiltDependenciesFile = path.join(
      manifestDir,
      ospmSettings.onlyBuiltDependenciesFile
    );
  }

  if (ospmSettings.patchedDependencies) {
    settings.patchedDependencies = { ...ospmSettings.patchedDependencies };

    for (const [dep, patchFile] of Object.entries(
      ospmSettings.patchedDependencies
    )) {
      if (path.isAbsolute(patchFile)) continue;
      settings.patchedDependencies[dep] = path.join(manifestDir, patchFile);
    }
  }

  return settings;
}

function createVersionReferencesReplacer(
  manifest: ProjectManifest
): (spec: string) => string {
  const allDeps = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };

  return replaceVersionReferences.bind(null, allDeps);
}

function replaceVersionReferences(
  dep: Record<string, string>,
  spec: string
): string {
  if (!(spec[0] === '$')) return spec;
  const dependencyName = spec.slice(1);
  const newSpec = dep[dependencyName];
  if (typeof newSpec === 'string') {
    return newSpec;
  }

  throw new OspmError(
    'CANNOT_RESOLVE_OVERRIDE_VERSION',
    `Cannot resolve version ${spec} in overrides. The direct dependencies don't have dependency "${dependencyName}".`
  );
}
