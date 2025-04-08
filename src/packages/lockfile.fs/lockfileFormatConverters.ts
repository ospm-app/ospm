import { removeSuffix } from '../dependency-path/index.ts';
import type {
  LockfileObject,
  ProjectSnapshot,
  LockfilePackageSnapshot,
  ResolvedDependencies,
  LockfileFile,
  LockfileFileProjectSnapshot,
  LockfileFileProjectResolvedDependencies,
  LockfilePackageInfo,
  PackageSnapshots,
} from '../lockfile.types/index.ts';
import { type DepPath, DEPENDENCIES_FIELDS } from '../types/index.ts';
import isEmpty from 'ramda/src/isEmpty';
import _mapValues from 'ramda/src/map';
import omit from 'ramda/src/omit';
import pickBy from 'ramda/src/pickBy';
import pick from 'ramda/src/pick';
import { LOCKFILE_VERSION } from '../constants/index.ts';

export function convertToLockfileFile(lockfile: LockfileObject): LockfileFile {
  const packages: Record<string, LockfilePackageInfo> = {};
  const snapshots: Record<string, LockfilePackageSnapshot> = {};
  for (const [depPath, pkg] of Object.entries(lockfile.packages ?? {})) {
    snapshots[depPath] = pick.default(
      [
        'dependencies',
        'optionalDependencies',
        'transitivePeerDependencies',
        'optional',
        'id',
      ],
      pkg
    );

    const pkgId = removeSuffix(depPath);

    if (!packages[pkgId]) {
      packages[pkgId] = pick.default(
        [
          'bundledDependencies',
          'cpu',
          'deprecated',
          'engines',
          'hasBin',
          'libc',
          'name',
          'os',
          'peerDependencies',
          'peerDependenciesMeta',
          'resolution',
          'version',
        ],
        pkg
      );
    }
  }

  const newLockfile = {
    ...lockfile,
    snapshots,
    packages,
    lockfileVersion: LOCKFILE_VERSION,
    importers: mapValues(
      lockfile.importers ?? {},
      convertProjectSnapshotToInlineSpecifiersFormat
    ),
  };

  if (newLockfile.settings?.peersSuffixMaxLength === 1000) {
    newLockfile.settings = omit.default(
      ['peersSuffixMaxLength'],
      newLockfile.settings
    );
  }

  if (newLockfile.settings?.injectWorkspacePackages === false) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete newLockfile.settings.injectWorkspacePackages;
  }

  return normalizeLockfile(newLockfile);
}

function normalizeLockfile(lockfile: LockfileFile): LockfileFile {
  const lockfileToSave = {
    ...lockfile,
    importers: _mapValues.default((importer) => {
      const normalizedImporter: Partial<LockfileFileProjectSnapshot> = {};

      if (
        importer.dependenciesMeta != null &&
        !isEmpty.default(importer.dependenciesMeta)
      ) {
        normalizedImporter.dependenciesMeta = importer.dependenciesMeta;
      }

      for (const depType of DEPENDENCIES_FIELDS) {
        if (!isEmpty.default(importer[depType] ?? {})) {
          normalizedImporter[depType] = importer[depType];
        }
      }

      if (typeof importer.publishDirectory === 'string') {
        normalizedImporter.publishDirectory = importer.publishDirectory;
      }

      return normalizedImporter as LockfileFileProjectSnapshot;
    }, lockfile.importers ?? {}),
  };

  if (
    isEmpty.default(lockfileToSave.packages) ||
    lockfileToSave.packages == null
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.packages;
  }

  if (
    isEmpty.default(lockfileToSave.snapshots) ||
    lockfileToSave.snapshots == null
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.snapshots;
  }

  if (lockfileToSave.time) {
    lockfileToSave.time = pruneTimeInLockfile(
      lockfileToSave.time,
      lockfile.importers ?? {}
    );
  }

  if (
    lockfileToSave.catalogs != null &&
    isEmpty.default(lockfileToSave.catalogs)
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.catalogs;
  }

  if (
    lockfileToSave.overrides != null &&
    isEmpty.default(lockfileToSave.overrides)
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.overrides;
  }

  if (
    lockfileToSave.patchedDependencies != null &&
    isEmpty.default(lockfileToSave.patchedDependencies)
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.patchedDependencies;
  }

  if (
    typeof lockfileToSave.packageExtensionsChecksum === 'undefined' ||
    lockfileToSave.packageExtensionsChecksum === ''
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.packageExtensionsChecksum;
  }

  if (
    typeof lockfileToSave.ignoredOptionalDependencies === 'undefined' ||
    lockfileToSave.ignoredOptionalDependencies.length === 0
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.ignoredOptionalDependencies;
  }

  if (
    typeof lockfileToSave.pnpmfileChecksum === 'undefined' ||
    lockfileToSave.pnpmfileChecksum === ''
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete lockfileToSave.pnpmfileChecksum;
  }

  return lockfileToSave;
}

function pruneTimeInLockfile(
  time: Record<string, string>,
  importers: Record<string, LockfileFileProjectSnapshot>
): Record<string, string> {
  const rootDepPaths = new Set<string>();

  for (const importer of Object.values(importers)) {
    for (const depType of DEPENDENCIES_FIELDS) {
      for (const [depName, ref] of Object.entries(importer[depType] ?? {})) {
        const suffixStart = ref.version.indexOf('(');

        const refWithoutPeerSuffix =
          suffixStart === -1 ? ref.version : ref.version.slice(0, suffixStart);

        const depPath = refToRelative(refWithoutPeerSuffix, depName);

        if (depPath === null || depPath === '') {
          continue;
        }

        rootDepPaths.add(depPath);
      }
    }
  }
  return pickBy.default((_, depPath) => rootDepPaths.has(depPath), time);
}

function refToRelative(reference: string, pkgName: string): string | null {
  if (reference.startsWith('link:')) {
    return null;
  }
  if (reference.startsWith('file:')) {
    return reference;
  }
  if (
    !reference.includes('/') ||
    !reference.replace(/(?:\([^)]+\))+$/, '').includes('/')
  ) {
    return `/${pkgName}@${reference}`;
  }
  return reference;
}

export function convertToLockfileObject(
  lockfile: LockfileFile
): LockfileObject {
  const { importers, ...rest } = lockfile;

  const packages: PackageSnapshots = {};
  for (const [depPath, pkg] of Object.entries(lockfile.snapshots ?? {})) {
    const pkgId = removeSuffix(depPath);
    packages[depPath as DepPath] = Object.assign(
      pkg,
      lockfile.packages?.[pkgId]
    );
  }
  return {
    ...omit.default(['snapshots'], rest),
    packages,
    importers: mapValues(importers ?? {}, revertProjectSnapshot),
  };
}

function convertProjectSnapshotToInlineSpecifiersFormat(
  projectSnapshot: ProjectSnapshot
): LockfileFileProjectSnapshot {
  const { specifiers, ...rest } = projectSnapshot;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (specifiers == null) {
    return projectSnapshot as LockfileFileProjectSnapshot;
  }

  const convertBlock = (
    block?: ResolvedDependencies | undefined
  ): LockfileFileProjectResolvedDependencies | undefined => {
    return block != null
      ? convertResolvedDependenciesToInlineSpecifiersFormat(block, {
          specifiers,
        })
      : block;
  };

  return {
    ...rest,
    dependencies: convertBlock(projectSnapshot.dependencies ?? {}),
    optionalDependencies: convertBlock(
      projectSnapshot.optionalDependencies ?? {}
    ),
    devDependencies: convertBlock(projectSnapshot.devDependencies ?? {}),
  };
}

function convertResolvedDependenciesToInlineSpecifiersFormat(
  resolvedDependencies: ResolvedDependencies,
  { specifiers }: { specifiers: ResolvedDependencies }
): LockfileFileProjectResolvedDependencies {
  return mapValues(resolvedDependencies, (version, depName) => {
    return {
      specifier: specifiers[depName as keyof typeof specifiers] ?? '',
      version,
    };
  });
}

function revertProjectSnapshot(
  from: LockfileFileProjectSnapshot
): ProjectSnapshot {
  const specifiers: ResolvedDependencies = {};

  function moveSpecifiers(
    from: LockfileFileProjectResolvedDependencies
  ): ResolvedDependencies {
    const resolvedDependencies: ResolvedDependencies = {};
    for (const [depName, { specifier, version }] of Object.entries(from)) {
      const existingValue = specifiers[depName];
      if (existingValue != null && existingValue !== specifier) {
        throw new Error(
          `Project snapshot lists the same dependency more than once with conflicting versions: ${depName}`
        );
      }

      specifiers[depName] = specifier;
      resolvedDependencies[depName] = version;
    }
    return resolvedDependencies;
  }

  const dependencies =
    from.dependencies == null
      ? from.dependencies
      : moveSpecifiers(from.dependencies);
  const devDependencies =
    from.devDependencies == null
      ? from.devDependencies
      : moveSpecifiers(from.devDependencies);
  const optionalDependencies =
    from.optionalDependencies == null
      ? from.optionalDependencies
      : moveSpecifiers(from.optionalDependencies);

  return {
    ...from,
    specifiers,
    dependencies,
    devDependencies,
    optionalDependencies,
  };
}

function mapValues<T, U>(
  obj: Record<string, T>,
  mapper: (val: T, key: string) => U
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = mapper(value, key);
  }
  return result;
}
