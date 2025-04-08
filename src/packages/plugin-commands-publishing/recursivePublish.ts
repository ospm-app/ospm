import path from 'node:path';
import { createResolver } from '../client/index.ts';
import type { Config } from '../config/index.ts';
import { logger } from '../logger/index.ts';
import { pickRegistryForPackage } from '../pick-registry-for-package/index.ts';
import type { ResolveFunction } from '../resolver-base/index.ts';
import { sortPackages } from '../sort-packages/index.ts';
import type {
  Registries,
  ProjectRootDir,
  Project,
  WorkspaceDir,
  LockFileDir,
} from '../types/index.ts';
import pFilter from 'p-filter';
import pick from 'ramda/src/pick';
import { writeJsonFile } from 'write-json-file';
import { publish } from './publish.ts';

export type PublishRecursiveOpts = Required<
  Pick<
    Config,
    | 'bin'
    | 'cacheDir'
    | 'cliOptions'
    | 'dir'
    | 'pnpmHomeDir'
    | 'rawConfig'
    | 'registries'
    | 'workspaceDir'
  >
> &
  Partial<
    Pick<
      Config,
      | 'tag'
      | 'ca'
      | 'catalogs'
      | 'cert'
      | 'fetchTimeout'
      | 'force'
      | 'dryRun'
      | 'extraBinPaths'
      | 'extraEnv'
      | 'fetchRetries'
      | 'fetchRetryFactor'
      | 'fetchRetryMaxtimeout'
      | 'fetchRetryMintimeout'
      | 'key'
      | 'httpProxy'
      | 'httpsProxy'
      | 'localAddress'
      | 'lockfileDir'
      | 'noProxy'
      | 'npmPath'
      | 'offline'
      | 'selectedProjectsGraph'
      | 'strictSsl'
      | 'sslConfigs'
      | 'unsafePerm'
      | 'userAgent'
      | 'userConfig'
      | 'verifyStoreIntegrity'
    >
  > & {
    access?: 'public' | 'restricted';
    argv: {
      original: string[];
    };
    reportSummary?: boolean;
  };

export async function recursivePublish(
  opts: PublishRecursiveOpts & Required<Pick<Config, 'selectedProjectsGraph'>>
): Promise<{ exitCode: number }> {
  const pkgs = Object.values(opts.selectedProjectsGraph ?? {}).map(
    (wsPkg: {
      dependencies: ProjectRootDir[];
      package: Project;
    }): Project => {
      return wsPkg.package;
    }
  );

  const { resolve } = createResolver({
    ...opts,
    authConfig: opts.rawConfig,
    userConfig: opts.userConfig,
    retry: {
      factor: opts.fetchRetryFactor ?? 0,
      maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
      minTimeout: opts.fetchRetryMintimeout ?? 10_000,
      retries: opts.fetchRetries ?? 3,
    },
    timeout: opts.fetchTimeout,
  });

  const pkgsToPublish = await pFilter(pkgs, async (pkg) => {
    if (
      !pkg.manifest.name ||
      !pkg.manifest.version ||
      pkg.manifest.private === true
    ) {
      return false;
    }

    if (opts.force === true) {
      return true;
    }

    return !(await isAlreadyPublished(
      {
        dir: pkg.rootDir,
        lockfileDir:
          opts.lockfileDir ?? (pkg.rootDir as unknown as LockFileDir),
        registries: opts.registries,
        resolve,
      },
      pkg.manifest.name,
      pkg.manifest.version
    ));
  });

  const publishedPkgDirs = new Set<ProjectRootDir>(
    pkgsToPublish.map(({ rootDir }: Project): ProjectRootDir => {
      return rootDir;
    })
  );

  const publishedPackages: Array<{ name?: string; version?: string }> = [];

  if (publishedPkgDirs.size === 0) {
    logger.info({
      message: 'There are no new packages that should be published',
      prefix: opts.dir,
    });
  } else {
    const appendedArgs: string[] = [];

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions.access) {
      appendedArgs.push(`--access=${opts.cliOptions.access as string}`);
    }

    if (opts.dryRun === true) {
      appendedArgs.push('--dry-run');
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions.otp) {
      appendedArgs.push(`--otp=${opts.cliOptions.otp as string}`);
    }

    const chunks = sortPackages(opts.selectedProjectsGraph ?? {});

    const tag = opts.tag ?? 'latest';

    for (const chunk of chunks) {
      // NOTE: It should be possible to publish these packages concurrently.
      // However, looks like that requires too much resources for some CI envs.
      // See related issue: https://github.com/pnpm/pnpm/issues/6968
      for (const pkgDir of chunk) {
        if (!publishedPkgDirs.has(pkgDir)) {
          continue;
        }

        const pkg = opts.selectedProjectsGraph?.[pkgDir]?.package;

        if (typeof pkg === 'undefined') {
          continue;
        }

        const registry =
          pkg.manifest.publishConfig?.registry ??
          pickRegistryForPackage(opts.registries, pkg.manifest.name);

        const publishResult = await publish(
          {
            ...opts,
            storeDir: '',
            workspaceDir: opts.workspaceDir ?? (opts.dir as WorkspaceDir),
            dir: pkg.rootDir,
            argv: {
              original: [
                'publish',
                '--tag',
                tag,
                '--registry',
                registry,
                ...appendedArgs,
              ],
            },
            gitChecks: false,
            recursive: false,
          },
          [pkg.rootDir]
        );

        if (publishResult.manifest != null) {
          publishedPackages.push(
            pick.default(['name', 'version'], publishResult.manifest)
          );
        } else if (typeof publishResult.exitCode === 'number') {
          return { exitCode: publishResult.exitCode };
        }
      }
    }
  }

  if (opts.reportSummary === true) {
    await writeJsonFile(
      path.join(opts.lockfileDir ?? opts.dir, 'pnpm-publish-summary.json'),
      { publishedPackages }
    );
  }

  return { exitCode: 0 };
}

async function isAlreadyPublished(
  opts: {
    dir: string;
    lockfileDir: LockFileDir;
    registries: Registries;
    resolve: ResolveFunction;
  },
  pkgName: string,
  pkgVersion: string
): Promise<boolean> {
  try {
    await opts.resolve(
      { alias: pkgName, pref: pkgVersion },
      {
        lockfileDir: opts.lockfileDir,
        preferredVersions: {},
        projectDir: opts.dir,
        registry: pickRegistryForPackage(opts.registries, pkgName, pkgVersion),
      }
    );
    return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  } catch (_err: any) {
    return false;
  }
}
