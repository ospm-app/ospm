import type {
  LockfileObject,
  PackageSnapshot,
  PackageSnapshots,
} from '../lockfile.types/index.ts';
import type { DepPath, ProjectId } from '../types/index.ts';
import comverToSemver from 'comver-to-semver';
import semver from 'semver';

export function mergeLockfileChanges(
  ours: LockfileObject,
  theirs: LockfileObject
): LockfileObject {
  const newLockfile: LockfileObject = {
    importers: {},
    lockfileVersion: semver.gt(
      comverToSemver(theirs.lockfileVersion.toString()),
      comverToSemver(ours.lockfileVersion.toString())
    )
      ? theirs.lockfileVersion
      : ours.lockfileVersion,
  };

  const pnpmfileChecksum = ours.pnpmfileChecksum ?? theirs.pnpmfileChecksum; // Install should automatically detect change later

  if (typeof pnpmfileChecksum === 'string') {
    newLockfile.pnpmfileChecksum = pnpmfileChecksum;
  }

  const ignoredOptionalDependencies = [
    ...new Set([
      ...(ours.ignoredOptionalDependencies ?? []),
      ...(theirs.ignoredOptionalDependencies ?? []),
    ]),
  ];

  if (ignoredOptionalDependencies.length) {
    newLockfile.ignoredOptionalDependencies = ignoredOptionalDependencies;
  }

  for (const importerId of Array.from(
    new Set([
      ...Object.keys(ours.importers ?? {}),
      ...Object.keys(theirs.importers ?? {}),
    ] as ProjectId[])
  )) {
    if (typeof newLockfile.importers === 'undefined') {
      newLockfile.importers = {};
    }

    newLockfile.importers[importerId] = {
      specifiers: {},
    };

    for (const key of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ] as const) {
      newLockfile.importers[importerId][key] = mergeDict(
        ours.importers?.[importerId]?.[key] ?? {},
        theirs.importers?.[importerId]?.[key] ?? {},
        mergeVersions
      );

      if (Object.keys(newLockfile.importers[importerId][key]).length === 0) {
        delete newLockfile.importers[importerId][key];
      }
    }

    newLockfile.importers[importerId].specifiers = mergeDict(
      ours.importers?.[importerId]?.specifiers ?? {},
      theirs.importers?.[importerId]?.specifiers ?? {},
      takeChangedValue
    );
  }

  const packages: PackageSnapshots = {};

  for (const depPath of Array.from(
    new Set([
      ...Object.keys(ours.packages ?? {}),
      ...Object.keys(theirs.packages ?? {}),
    ])
  ) as DepPath[]) {
    const ourPkg = ours.packages?.[depPath];

    const theirPkg = theirs.packages?.[depPath];

    const pkg = {
      ...ourPkg,
      ...theirPkg,
    };

    for (const key of ['dependencies', 'optionalDependencies'] as const) {
      pkg[key] = mergeDict(
        ourPkg?.[key] ?? {},
        theirPkg?.[key] ?? {},
        mergeVersions
      );

      if (Object.keys(pkg[key] ?? {}).length === 0) {
        delete pkg[key];
      }
    }

    packages[depPath] = pkg as PackageSnapshot;
  }

  newLockfile.packages = packages;

  return newLockfile;
}

type ValueMerger<T> = (ourValue: T, theirValue: T) => T;

function mergeDict<T>(
  ourDict: Record<string, T>,
  theirDict: Record<string, T>,
  valueMerger: ValueMerger<T>
): Record<string, T> {
  const newDict: Record<string, T> = {};

  for (const key of Object.keys(ourDict).concat(Object.keys(theirDict))) {
    const value = ourDict[key];

    const theirValue = theirDict[key];

    if (typeof value === 'undefined' || typeof theirValue === 'undefined') {
      continue;
    }

    const changedValue = valueMerger(value, theirValue);

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (changedValue) {
      newDict[key] = changedValue;
    }
  }

  return newDict;
}

function takeChangedValue<T>(ourValue: T, theirValue: T): T {
  if (ourValue === theirValue || theirValue == null) {
    return ourValue;
  }

  return theirValue;
}

function mergeVersions(ourValue: string, theirValue: string): string {
  if (ourValue === theirValue || !theirValue) {
    return ourValue;
  }

  if (!ourValue) {
    return theirValue;
  }

  const [ourVersion] = ourValue.split('(');

  const [theirVersion] = theirValue.split('(');

  if (
    typeof ourVersion === 'undefined' ||
    typeof theirVersion === 'undefined'
  ) {
    return theirValue;
  }

  if (semver.gt(ourVersion, theirVersion)) {
    return ourValue;
  }

  return theirValue;
}
