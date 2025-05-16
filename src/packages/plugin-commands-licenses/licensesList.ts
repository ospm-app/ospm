import { readProjectManifestOnly } from '../cli-utils/index.ts';
import type { Config } from '../config/index.ts';
import { OspmError } from '../error/index.ts';
import { getStorePath } from '../store-path/index.ts';
import { WANTED_LOCKFILE } from '../constants/index.ts';
import {
  getLockfileImporterId,
  readWantedLockfile,
} from '../lockfile.fs/index.ts';
import { findDependencyLicenses } from '../license-scanner/index.ts';
import type { LicensesCommandResult } from './LicensesCommandResult.ts';
import { renderLicenses } from './outputRenderer.ts';
import { getOptionsFromRootManifest } from '../config/getOptionsFromRootManifest.ts';

export type LicensesCommandOptions = {
  compatible?: boolean | undefined;
  long?: boolean | undefined;
  recursive?: boolean | undefined;
  json?: boolean | undefined;
} & Pick<
  Config,
  | 'dev'
  | 'dir'
  | 'lockfileDir'
  | 'registries'
  | 'optional'
  | 'production'
  | 'storeDir'
  | 'virtualStoreDir'
  | 'modulesDir'
  | 'ospmHomeDir'
  | 'selectedProjectsGraph'
  | 'rootProjectManifest'
  | 'rootProjectManifestDir'
  | 'virtualStoreDirMaxLength'
> &
  Partial<Pick<Config, 'userConfig'>>;

export async function licensesList(
  opts: LicensesCommandOptions
): Promise<LicensesCommandResult> {
  const lockfile = await readWantedLockfile(opts.lockfileDir ?? opts.dir, {
    ignoreIncompatible: true,
  });

  if (lockfile === null) {
    throw new OspmError(
      'LICENSES_NO_LOCKFILE',
      `No ${WANTED_LOCKFILE} found: Cannot check a project without a lockfile`
    );
  }

  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  const manifest = await readProjectManifestOnly(opts.dir);

  const includedImporterIds = opts.selectedProjectsGraph
    ? Object.keys(opts.selectedProjectsGraph).map((path) =>
        getLockfileImporterId(opts.lockfileDir ?? opts.dir, path)
      )
    : undefined;

  const storeDir = await getStorePath({
    pkgRoot: opts.dir,
    storePath: opts.storeDir,
    ospmHomeDir: opts.ospmHomeDir,
  });

  const licensePackages = await findDependencyLicenses({
    include,
    lockfileDir: opts.lockfileDir ?? opts.dir,
    storeDir,
    virtualStoreDir: opts.virtualStoreDir ?? '.',
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    modulesDir: opts.modulesDir,
    registries: opts.registries,
    wantedLockfile: lockfile,
    manifest,
    includedImporterIds,
    supportedArchitectures: getOptionsFromRootManifest(
      opts.rootProjectManifestDir,
      opts.rootProjectManifest
    ).supportedArchitectures,
  });

  if (licensePackages.length === 0)
    return { output: 'No licenses in packages found', exitCode: 0 };

  return renderLicenses(licensePackages, opts);
}
