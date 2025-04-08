import path from 'node:path';
import pathAbsolute from 'path-absolute';
import { readFile } from 'node:fs/promises';
import { readPackageJson } from '../read-package-json/index.ts';
import { depPathToFilename, parse } from '../dependency-path/index.ts';
import pLimit from 'p-limit';
import type {
  ModulesDir,
  PackageManifest,
  Registries,
} from '../types/index.ts';
import {
  getFilePathByModeInCafs,
  getIndexFilePathInCafs,
  type PackageFiles,
  type PackageFileInfo,
  type PackageFilesIndex,
} from '../store.cafs/index.ts';
import { loadJsonFile } from 'load-json-file';
import { PnpmError } from '../error/index.ts';
import type { LicensePackage } from './licenses.ts';
import { pkgSnapshotToResolution } from '../lockfile.utils/index.ts';
import { fetchFromDir } from '../directory-fetcher/index.ts';
import type { PackageSnapshot } from '../lockfile.types/index.ts';
import type { Resolution } from '../resolver-base/index.ts';

const limitPkgReads = pLimit(4);

export async function readPkg(pkgPath: string): Promise<PackageManifest> {
  return limitPkgReads(async () => readPackageJson(pkgPath));
}

/**
 * @const
 * List of typical names for license files
 */
const LICENSE_FILES = [
  'LICENSE',
  'LICENCE',
  'LICENSE.md',
  'LICENCE.md',
  'LICENSE.txt',
  'LICENCE.txt',
  'MIT-LICENSE.txt',
  'MIT-LICENSE.md',
  'MIT-LICENSE',
];

/**
 * @const
 * List common license names
 * Refer https://github.com/pivotal/LicenseFinder/blob/master/lib/license_finder/license/definitions.rb
 */
const LICENSE_NAMES = [
  'Apache1_1',
  'Apache-1.1',
  'Apache 1.1',
  'Apache2',
  'Apache-2.0',
  'Apache 2.0',
  'BSD',
  'BSD-4-Clause',
  'CC01',
  'CC0-1.0',
  'CC0 1.0',
  'CDDL1',
  'CDDL-1.0',
  'Common Development and Distribution License 1.0',
  'EPL1',
  'EPL-1.0',
  'Eclipse Public License 1.0',
  'GPLv2',
  'GPL-2.0-only',
  'GPLv3',
  'GPL-3.0-only',
  'ISC',
  'LGPL',
  'LGPL-3.0-only',
  'LGPL2_1',
  'LGPL-2.1-only',
  'MIT',
  'MPL1_1',
  'MPL-1.1',
  'Mozilla Public License 1.1',
  'MPL2',
  'MPL-2.0',
  'Mozilla Public License 2.0',
  'NewBSD',
  'BSD-3-Clause',
  'New BSD',
  'OFL',
  'OFL-1.1',
  'SIL OPEN FONT LICENSE Version 1.1',
  'Python',
  'PSF-2.0',
  'Python Software Foundation License',
  'Ruby',
  'SimplifiedBSD',
  'BSD-2-Clause',
  'Simplified BSD',
  'WTFPL',
  '0BSD',
  'BSD Zero Clause License',
  'Zlib',
  'zlib/libpng license',
];

export interface LicenseInfo {
  name: string;
  licenseFile?: string | undefined;
}

/**
 * Coerce the given value to a string or a null value
 * @param field the string to be converted
 * @returns string | null
 */
function coerceToString(field: unknown): string | null {
  const string = String(field);
  return typeof field === 'string' || field === string ? string : null;
}

/**
 * Parses the value of the license-property of a
 * package manifest and return it as a string
 * @param field the value to parse
 * @returns string
 */
function parseLicenseManifestField(field: unknown): string | null {
  if (Array.isArray(field)) {
    const licenses = field;

    const licenseTypes = licenses
      .map((license: unknown): string | null => {
        return typeof license === 'object' && license !== null
          ? (('type' in license ? coerceToString(license.type) : null) ??
              ('name' in license ? coerceToString(license.name) : null))
          : null;
      })
      .filter((licenseType): licenseType is string => {
        return licenseType !== null;
      });

    if (licenseTypes.length > 1) {
      const combinedLicenseTypes = licenseTypes.join(' OR ');

      return `(${combinedLicenseTypes})`;
    }

    return licenseTypes[0] ?? null;
  }

  return typeof field === 'object' &&
    field !== null &&
    'type' in field &&
    typeof field.type === 'string'
    ? field.type
    : coerceToString(field);
}

/**
 * Reads the license field or LICENSE file from
 * the directory of the given package manifest
 *
 * If the package.json file is missing the `license`-property
 * the root of the manifest directory will be scanned for
 * files named listed in the array LICENSE_FILES and the
 * contents will be returned.
 *
 * @param {*} pkg the package to check
 * @param {*} opts the options for parsing licenses
 * @returns Promise<LicenseInfo>
 */
async function parseLicense(
  pkg: {
    manifest: PackageManifest;
    files:
      | { local: true; files: Record<string, string> }
      | { local: false; files: PackageFiles };
  },
  opts: { storeDir: string }
): Promise<LicenseInfo> {
  let licenseField: unknown = pkg.manifest.license;

  if ('licenses' in pkg.manifest) {
    licenseField = pkg.manifest.licenses;
  }

  const license = parseLicenseManifestField(licenseField);

  // check if we discovered a license, if not attempt to parse the LICENSE file
  if (license === null || /see license/i.test(license)) {
    const { files: pkgFileIndex } = pkg.files;

    const licenseFile = LICENSE_FILES.find(
      (licenseFile) => licenseFile in pkgFileIndex
    );

    if (typeof licenseFile !== 'undefined') {
      const licensePackageFileInfo = pkgFileIndex[licenseFile];

      let licenseContents: Buffer | undefined;

      if (pkg.files.local) {
        licenseContents = await readFile(licensePackageFileInfo as string);
      } else {
        licenseContents = await readLicenseFileFromCafs(
          opts.storeDir,
          licensePackageFileInfo as PackageFileInfo
        );
      }

      const licenseContent = licenseContents.toString('utf-8');

      let name = 'Unknown';

      if (licenseContent) {
        const match = licenseContent.match(
          new RegExp(`\\b(${LICENSE_NAMES.join('|')})\\b`, 'gi')
        );

        if (match !== null) {
          name = [...new Set(match)].join(' OR ');
        }
      }

      return {
        name,
        licenseFile: licenseContent,
      };
    }
  }

  return { name: license ?? 'Unknown' };
}

/**
 * Fetch a file by integrity id from the content-addressable store
 * @param storeDir the cafs directory
 * @param opts the options for reading file
 * @returns Promise<Buffer>
 */
async function readLicenseFileFromCafs(
  storeDir: string,
  { integrity, mode }: PackageFileInfo
): Promise<Buffer> {
  const fileName = getFilePathByModeInCafs(storeDir, integrity, mode);
  const fileContents = await readFile(fileName);
  return fileContents;
}

export type ReadPackageIndexFileResult =
  | { local: false; files: PackageFiles }
  | { local: true; files: Record<string, string> };

export interface ReadPackageIndexFileOptions {
  storeDir: string;
  lockfileDir: string;
  virtualStoreDirMaxLength: number;
}

/**
 * Returns the index of files included in
 * the package identified by the integrity id
 * @param packageResolution the resolution package information
 * @param depPath the package reference
 * @param opts options for fetching package file index
 */
export async function readPackageIndexFile(
  packageResolution: Resolution,
  id: string,
  opts: ReadPackageIndexFileOptions
): Promise<ReadPackageIndexFileResult> {
  // If the package resolution is of type directory we need to do things
  // differently and generate our own package index file
  const isLocalPkg =
    'type' in packageResolution && packageResolution.type === 'directory';

  if (isLocalPkg) {
    const localInfo = await fetchFromDir(
      path.join(opts.lockfileDir, packageResolution.directory),
      {}
    );

    return {
      local: true,
      files: localInfo.filesIndex,
    };
  }

  const isPackageWithIntegrity = 'integrity' in packageResolution;

  let pkgIndexFilePath: string | undefined;

  if (isPackageWithIntegrity) {
    const parsedId = parse(id);
    // Retrieve all the index file of all files included in the package
    pkgIndexFilePath = getIndexFilePathInCafs(
      opts.storeDir,
      packageResolution.integrity as string,
      `${parsedId.name}@${parsedId.version}`
    );
  } else if (
    !('type' in packageResolution) &&
    typeof packageResolution.tarball === 'string'
  ) {
    const packageDirInStore = depPathToFilename(
      parse(id).nonSemverVersion ?? id,
      opts.virtualStoreDirMaxLength
    );

    pkgIndexFilePath = path.join(
      opts.storeDir,
      packageDirInStore,
      'integrity.json'
    );
  } else {
    throw new PnpmError(
      'UNSUPPORTED_PACKAGE_TYPE',
      `Unsupported package resolution type for ${id}`
    );
  }

  try {
    const { files } = await loadJsonFile<PackageFilesIndex>(pkgIndexFilePath);

    return {
      local: false,
      files,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new PnpmError(
        'MISSING_PACKAGE_INDEX_FILE',
        `Failed to find package index file for ${id} (at ${pkgIndexFilePath}), please consider running 'pnpm install'`
      );
    }

    throw err;
  }
}

export type PackageInfo = {
  id: string;
  name?: string | undefined;
  version?: string | undefined;
  depPath: string;
  snapshot: PackageSnapshot;
  registries: Registries;
};

export type GetPackageInfoOptions = {
  storeDir: string;
  virtualStoreDir: string;
  virtualStoreDirMaxLength: number;
  dir: string;
  modulesDir: ModulesDir;
};

export type PkgInfo = {
  from: string;
  description?: string | undefined;
} & Omit<LicensePackage, 'belongsTo'>;

/**
 * Returns the package manifest information for a give package name and path
 * @param pkg the package to fetch information for
 * @param opts the fetching options
 */
export async function getPkgInfo(
  pkg: PackageInfo,
  opts: GetPackageInfoOptions
): Promise<PkgInfo> {
  // Retrieve file index for the requested package
  const packageResolution = pkgSnapshotToResolution(
    pkg.depPath,
    pkg.snapshot,
    pkg.registries
  );

  if (typeof packageResolution === 'undefined') {
    throw new PnpmError(
      'MISSING_PACKAGE_RESOLUTION',
      `Failed to find package resolution for ${pkg.id}`
    );
  }

  const packageFileIndexInfo = await readPackageIndexFile(
    packageResolution,
    pkg.id,
    {
      storeDir: opts.storeDir,
      lockfileDir: opts.dir,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    }
  );

  // Fetch the package manifest
  let packageManifestDir: string | undefined;

  if (packageFileIndexInfo.local) {
    packageManifestDir = packageFileIndexInfo.files['package.json'];
  } else {
    const packageFileIndex = packageFileIndexInfo.files as Record<
      string,
      PackageFileInfo
    >;

    const packageManifestFile = packageFileIndex['package.json'];

    if (typeof packageManifestFile === 'undefined') {
      throw new PnpmError(
        'MISSING_PACKAGE_MANIFEST',
        `Failed to find package manifest file for ${pkg.id}`
      );
    }

    packageManifestDir = getFilePathByModeInCafs(
      opts.storeDir,
      packageManifestFile.integrity,
      packageManifestFile.mode
    );
  }

  if (typeof packageManifestDir === 'undefined') {
    throw new PnpmError(
      'MISSING_PACKAGE_MANIFEST_DIR',
      `Failed to find package manifest directory for ${pkg.id}`
    );
  }

  let manifest: PackageManifest;

  try {
    manifest = await readPkg(packageManifestDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new PnpmError(
        'MISSING_PACKAGE_MANIFEST',
        `Failed to find package manifest file at ${packageManifestDir}`
      );
    }

    throw err;
  }

  // Determine the path to the package as known by the user
  const modulesDir = opts.modulesDir;

  const virtualStoreDir = pathAbsolute(
    opts.virtualStoreDir || path.join(modulesDir, '.pnpm'),
    opts.dir
  );

  // TODO: fix issue that path is only correct when using node-linked=isolated
  const packageModulePath = path.join(
    virtualStoreDir,
    depPathToFilename(pkg.depPath, opts.virtualStoreDirMaxLength),
    modulesDir,
    manifest.name
  );

  const licenseInfo = await parseLicense(
    { manifest, files: packageFileIndexInfo },
    { storeDir: opts.storeDir }
  );

  const packageInfo = {
    from: manifest.name,
    path: packageModulePath,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: licenseInfo.name,
    licenseContents: licenseInfo.licenseFile,
    author:
      typeof manifest.author === 'undefined'
        ? undefined
        : typeof manifest.author === 'string'
          ? manifest.author
          : manifest.author.name,
    homepage: manifest.homepage,
    repository:
      typeof manifest.repository === 'undefined'
        ? undefined
        : typeof manifest.repository === 'string'
          ? manifest.repository
          : manifest.repository.url,
  };

  return packageInfo;
}
