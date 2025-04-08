import path from 'node:path';
import { PnpmError } from '../error/index.ts';
import type {
  SupportedArchitectures,
  AllowedDeprecatedVersions,
  PackageExtension,
  PeerDependencyRules,
  ProjectManifest,
  PnpmSettings,
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
} & Pick<PnpmSettings, 'configDependencies'>;

export function getOptionsFromRootManifest(
  manifestDir:
    | LockFileDir
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir,
  manifest?: ProjectManifest | undefined
): OptionsFromRootManifest {
  const settings: OptionsFromRootManifest = getOptionsFromPnpmSettings(
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
        manifest?.pnpm ?? {}
      ),
      // We read Yarn's resolutions field for compatibility
      // but we really replace the version specs to any other version spec, not only to exact versions,
      // so we cannot call it resolutions
      overrides: {
        ...manifest?.resolutions,
        ...manifest?.pnpm?.overrides,
      },
    },
    manifest
  );

  return settings;
}

export function getOptionsFromPnpmSettings(
  manifestDir: string,
  pnpmSettings: PnpmSettings,
  manifest?: ProjectManifest | undefined
): OptionsFromRootManifest {
  const settings: OptionsFromRootManifest = { ...pnpmSettings };
  if (settings.overrides) {
    if (Object.keys(settings.overrides).length === 0) {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete settings.overrides;
    } else if (manifest) {
      settings.overrides = mapValues.default(
        createVersionReferencesReplacer(manifest),
        settings.overrides
      );
    }
  }

  if (typeof pnpmSettings.onlyBuiltDependenciesFile === 'string') {
    settings.onlyBuiltDependenciesFile = path.join(
      manifestDir,
      pnpmSettings.onlyBuiltDependenciesFile
    );
  }

  if (pnpmSettings.patchedDependencies) {
    settings.patchedDependencies = { ...pnpmSettings.patchedDependencies };

    for (const [dep, patchFile] of Object.entries(
      pnpmSettings.patchedDependencies
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

  throw new PnpmError(
    'CANNOT_RESOLVE_OVERRIDE_VERSION',
    `Cannot resolve version ${spec} in overrides. The direct dependencies don't have dependency "${dependencyName}".`
  );
}
