import path from 'node:path';
import semver from 'semver';
import partition from 'ramda/src/partition';
import type {
  Dependencies,
  GlobalPkgDir,
  LockFileDir,
  PackageManifest,
  ProjectRootDir,
  ProjectRootDirRealPath,
  ReadPackageHook,
  WorkspaceDir,
} from '../types/index.ts';
import type {
  PackageSelector,
  VersionOverride as VersionOverrideBase,
} from '../parse-overrides/index.ts';
import { isValidPeerRange } from '../semver.peer-range/index.ts';
import normalizePath from 'normalize-path';
import { isIntersectingRange } from './isIntersectingRange.ts';

export type VersionOverrideWithoutRawSelector = Omit<
  VersionOverrideBase,
  'selector'
>;

export function createVersionsOverrider(
  overrides: (
    | {
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
  )[],
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir
): ReadPackageHook {
  const [versionOverrides, genericVersionOverrides] = partition.default(
    ({
      parentPkg,
    }: {
      localTarget: LocalTarget | undefined;
      parentPkg?: PackageSelector | undefined;
      targetPkg: PackageSelector;
      newPref: string;
    }): boolean => {
      return parentPkg != null;
    },
    overrides.map(
      (
        override:
          | {
              parentPkg: PackageSelector;
              targetPkg: PackageSelector;
              selector: string;
              newPref: string;
            }
          | {
              targetPkg: PackageSelector;
              selector: string;
              newPref: string;
            }
      ):
        | {
            localTarget: LocalTarget | undefined;
            parentPkg: PackageSelector;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
        | {
            localTarget: LocalTarget | undefined;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          } => {
        return {
          ...override,
          localTarget: createLocalTarget(override, rootDir),
        };
      }
    )
  ); // as [VersionOverrideWithParent[], VersionOverride[]];

  return (
    manifest: PackageManifest,
    dir?: string | undefined
  ): PackageManifest => {
    const versionOverridesWithParent = versionOverrides.filter(
      (
        versionOverride:
          | {
              localTarget: LocalTarget | undefined;
              parentPkg: PackageSelector;
              targetPkg: PackageSelector;
              selector: string;
              newPref: string;
            }
          | {
              localTarget: LocalTarget | undefined;
              targetPkg: PackageSelector;
              selector: string;
              newPref: string;
            }
      ): boolean => {
        return (
          'parentPkg' in versionOverride &&
          versionOverride.parentPkg.name === manifest.name &&
          (typeof versionOverride.parentPkg.pref === 'undefined' ||
            semver.satisfies(manifest.version, versionOverride.parentPkg.pref))
        );
      }
    );

    overrideDepsOfPkg(
      { manifest, dir },
      versionOverridesWithParent,
      genericVersionOverrides
    );

    return manifest;
  };
}

interface LocalTarget {
  protocol: LocalProtocol;
  absolutePath: string;
  specifiedViaRelativePath: boolean;
}

type LocalProtocol = 'link:' | 'file:';

function createLocalTarget(
  override:
    | {
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      },
  rootDir:
    | ProjectRootDir
    | ProjectRootDirRealPath
    | GlobalPkgDir
    | WorkspaceDir
    | LockFileDir
): LocalTarget | undefined {
  let protocol: LocalProtocol | undefined;

  if (override.newPref.startsWith('file:')) {
    protocol = 'file:';
  } else if (override.newPref.startsWith('link:')) {
    protocol = 'link:';
  } else {
    return undefined;
  }

  const pkgPath = override.newPref.substring(protocol.length);

  const specifiedViaRelativePath = !path.isAbsolute(pkgPath);

  const absolutePath = specifiedViaRelativePath
    ? path.join(rootDir, pkgPath)
    : pkgPath;

  return { absolutePath, specifiedViaRelativePath, protocol };
}

// interface VersionOverride extends VersionOverrideBase {
//   localTarget?: LocalTarget | undefined;
// }

// interface VersionOverrideWithParent extends VersionOverride {
//   parentPkg: PackageSelector;
// }

function overrideDepsOfPkg(
  { manifest, dir }: { manifest: PackageManifest; dir: string | undefined },
  versionOverrides: (
    | {
        localTarget: LocalTarget | undefined;
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        localTarget: LocalTarget | undefined;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
  )[],
  genericVersionOverrides: (
    | {
        localTarget: LocalTarget | undefined;
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        localTarget: LocalTarget | undefined;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
  )[]
): void {
  const {
    dependencies,
    optionalDependencies,
    devDependencies,
    peerDependencies,
  } = manifest;

  const _overrideDeps = overrideDeps.bind(null, {
    versionOverrides,
    genericVersionOverrides,
    dir,
  });

  for (const deps of [dependencies, optionalDependencies, devDependencies]) {
    if (deps) {
      _overrideDeps(deps, undefined);
    }
  }

  if (peerDependencies) {
    if (!manifest.dependencies) manifest.dependencies = {};
    _overrideDeps(manifest.dependencies, peerDependencies);
  }
}

function overrideDeps(
  {
    versionOverrides,
    genericVersionOverrides,
    dir,
  }: {
    versionOverrides: (
      | {
          localTarget: LocalTarget | undefined;
          parentPkg: PackageSelector;
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        }
      | {
          localTarget: LocalTarget | undefined;
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        }
    )[];
    genericVersionOverrides: (
      | {
          localTarget: LocalTarget | undefined;
          parentPkg: PackageSelector;
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        }
      | {
          localTarget: LocalTarget | undefined;
          targetPkg: PackageSelector;
          selector: string;
          newPref: string;
        }
    )[];
    dir: string | undefined;
  },
  deps: Dependencies,
  peerDeps: Dependencies | undefined
): void {
  for (const [name, pref] of Object.entries(peerDeps ?? deps)) {
    const versionOverride =
      pickMostSpecificVersionOverride(
        versionOverrides.filter(
          ({
            targetPkg,
          }:
            | {
                localTarget: LocalTarget | undefined;
                parentPkg: PackageSelector;
                targetPkg: PackageSelector;
                selector: string;
                newPref: string;
              }
            | {
                localTarget: LocalTarget | undefined;
                targetPkg: PackageSelector;
                selector: string;
                newPref: string;
              }): boolean => {
            return (
              targetPkg.name === name &&
              isIntersectingRange(targetPkg.pref, pref)
            );
          }
        )
      ) ??
      pickMostSpecificVersionOverride(
        genericVersionOverrides.filter(
          ({
            targetPkg,
          }:
            | {
                localTarget: LocalTarget | undefined;
                parentPkg: PackageSelector;
                targetPkg: PackageSelector;
                selector: string;
                newPref: string;
              }
            | {
                localTarget: LocalTarget | undefined;
                targetPkg: PackageSelector;
                selector: string;
                newPref: string;
              }): boolean => {
            return (
              targetPkg.name === name &&
              isIntersectingRange(targetPkg.pref, pref)
            );
          }
        )
      );

    if (typeof versionOverride === 'undefined') {
      continue;
    }

    if (versionOverride.newPref === '-') {
      if (typeof peerDeps === 'undefined') {
        delete deps[versionOverride.targetPkg.name];
      } else {
        delete peerDeps[versionOverride.targetPkg.name];
      }

      continue;
    }

    const newPref = versionOverride.localTarget
      ? `${versionOverride.localTarget.protocol}${resolveLocalOverride(versionOverride.localTarget, dir)}`
      : versionOverride.newPref;

    if (peerDeps == null || !isValidPeerRange(newPref)) {
      deps[versionOverride.targetPkg.name] = newPref;
    } else if (isValidPeerRange(newPref)) {
      peerDeps[versionOverride.targetPkg.name] = newPref;
    }
  }
}

function resolveLocalOverride(
  { specifiedViaRelativePath, absolutePath }: LocalTarget,
  pkgDir?: string
): string {
  return specifiedViaRelativePath && typeof pkgDir === 'string'
    ? normalizePath(path.relative(pkgDir, absolutePath))
    : absolutePath;
}

function pickMostSpecificVersionOverride(
  versionOverrides: (
    | {
        localTarget: LocalTarget | undefined;
        parentPkg: PackageSelector;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
    | {
        localTarget: LocalTarget | undefined;
        targetPkg: PackageSelector;
        selector: string;
        newPref: string;
      }
  )[]
):
  | {
      localTarget: LocalTarget | undefined;
      parentPkg: PackageSelector;
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
  | {
      localTarget: LocalTarget | undefined;
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
  | undefined {
  return versionOverrides.sort(
    (
      a:
        | {
            localTarget: LocalTarget | undefined;
            parentPkg: PackageSelector;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
        | {
            localTarget: LocalTarget | undefined;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          },
      b:
        | {
            localTarget: LocalTarget | undefined;
            parentPkg: PackageSelector;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
        | {
            localTarget: LocalTarget | undefined;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
    ): 1 | -1 => {
      return isIntersectingRange(b.targetPkg.pref ?? '', a.targetPkg.pref ?? '')
        ? -1
        : 1;
    }
  )[0];
}
