import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getCatalogsFromWorkspaceManifest } from '../catalogs.config/index.ts';
import { LAYOUT_VERSION } from '../constants/index.ts';
import { OspmError } from '../error/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { loadNpmConf, defaults } from '@ospm/npm-conf';
import type { types as npmTypes } from '@pnpm/npm-conf/lib/types.ts';
import { safeReadProjectManifestOnly } from '../read-project-manifest/index.ts';
import { getCurrentBranch } from '../git-utils/index.ts';
import { createMatcher } from '../matcher/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import betterPathResolve from 'better-path-resolve';
import camelcase from 'camelcase';
import isWindows from 'is-windows';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import normalizeRegistryUrl from 'normalize-registry-url';
import realpathMissing from 'realpath-missing';
import pathAbsolute from 'path-absolute';
import which from 'which';
import { inheritAuthConfig } from './auth.ts';
import { checkGlobalBinDir } from './checkGlobalBinDir.ts';
import { getNetworkConfigs } from './getNetworkConfigs.ts';
import { getCacheDir, getConfigDir, getDataDir, getStateDir } from './dirs.ts';
import type {
  Config,
  ConfigWithDeprecatedSettings,
  UniversalOptions,
  VerifyDepsBeforeRun,
  WantedPackageManager,
} from './Config.ts';
import { getWorkspaceConcurrency } from './concurrency.ts';
import { readWorkspaceManifest } from '../workspace.read-manifest/index.ts';

import { types } from './types.ts';
import {
  getOptionsFromOspmSettings,
  getOptionsFromRootManifest,
  type OptionsFromRootManifest,
} from './getOptionsFromRootManifest.ts';
import process from 'node:process';
import type {
  GlobalPkgDir,
  LockFileDir,
  WorkspaceDir,
} from '../types/index.ts';

export type {
  Config,
  UniversalOptions,
  WantedPackageManager,
  VerifyDepsBeforeRun,
};

type CamelToKebabCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? '-' : ''}${Lowercase<T>}${CamelToKebabCase<U>}`
  : S;

export type KebabCaseConfig =
  | {
      [K in keyof ConfigWithDeprecatedSettings as CamelToKebabCase<K>]: ConfigWithDeprecatedSettings[K];
    }
  | typeof npmTypes;

const npmDefaults = defaults;

export type CliOptions = {
  //Record<string, unknown> &
  version?: boolean | undefined;
  dir?: string | undefined;
  json?: boolean | undefined;
  hoist?: boolean | undefined;
  global?: boolean | undefined;
  recursive?: boolean | undefined;
  'shamefully-hoist'?: boolean | undefined;
  'shamefully-flatten'?: boolean | undefined;
  'hoist-pattern'?: string[] | undefined;
  prefix?: string | undefined;
  'workspace-root'?: boolean | undefined;
  'link-workspace-packages'?: boolean | undefined;
  'shared-workspace-lockfile'?: boolean | undefined;
  'lockfile-dir'?: string | undefined;
  'virtual-store-dir'?: string | undefined;
  'save-peer'?: boolean | undefined;
  'save-prod'?: boolean | undefined;
  'save-optional'?: boolean | undefined;
  'workspace-packages'?: boolean | undefined;
};

export async function getConfig<IP>(opts: {
  globalDirShouldAllowWrite?: boolean | undefined;
  cliOptions?: CliOptions | undefined;
  packageManager?:
    | {
        name: string;
        version: string;
      }
    | undefined;
  rcOptionsTypes?: Record<string, unknown> | undefined;
  workspaceDir?: WorkspaceDir | undefined;
  checkUnknownSetting?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
  ignoreNonAuthSettingsFromLocal?: boolean | undefined;
  ignoreLocalSettings?: boolean | undefined;
}): Promise<{ config: Config; warnings: string[] }> {
  if (opts.ignoreNonAuthSettingsFromLocal === true) {
    const { ignoreNonAuthSettingsFromLocal: _, ...authOpts } = opts;

    const globalCfgOpts: typeof authOpts = {
      ...authOpts,
      ignoreLocalSettings: true,
      cliOptions: {
        ...authOpts.cliOptions,
        dir: os.homedir(),
      },
    };

    const [final, authSrc] = await Promise.all([
      getConfig<IP>(globalCfgOpts),
      getConfig<IP>(authOpts),
    ]);

    inheritAuthConfig(final.config, authSrc.config);

    final.warnings.push(...authSrc.warnings);

    return final;
  }

  const env = opts.env ?? process.env;

  const packageManager = opts.packageManager ?? {
    name: 'ospm',
    version: 'undefined',
  };

  const cliOptions = opts.cliOptions ?? {};

  if (cliOptions.hoist === false) {
    if (cliOptions['shamefully-hoist'] === true) {
      throw new OspmError(
        'CONFIG_CONFLICT_HOIST',
        '--shamefully-hoist cannot be used with --no-hoist'
      );
    }

    if (cliOptions['shamefully-flatten'] === true) {
      throw new OspmError(
        'CONFIG_CONFLICT_HOIST',
        '--shamefully-flatten cannot be used with --no-hoist'
      );
    }

    if (typeof cliOptions['hoist-pattern'] !== 'undefined') {
      throw new OspmError(
        'CONFIG_CONFLICT_HOIST',
        '--hoist-pattern cannot be used with --no-hoist'
      );
    }
  }

  // This is what npm does as well, overriding process.execPath with the resolved location of Node.
  // The value of process.execPath is changed only for the duration of config initialization.
  // Otherwise, npmConfig.globalPrefix would sometimes have the bad location.
  //
  // TODO: use this workaround only during global installation
  const originalExecPath = process.execPath;

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const node = await which(process.argv[0]);

    if (node.toUpperCase() !== process.execPath.toUpperCase()) {
      process.execPath = node;
    }
  } catch {} // eslint-disable-line:no-empty

  if (typeof cliOptions.dir === 'string') {
    cliOptions.dir = await realpathMissing(cliOptions.dir);

    cliOptions.prefix = cliOptions.dir; // the npm config system still expects `prefix`
  }

  const rcOptionsTypes = { ...types, ...opts.rcOptionsTypes };

  const defaultOptions: Partial<KebabCaseConfig> = {
    'auto-install-peers': true,
    bail: true,
    color: 'auto',
    'deploy-all-files': false,
    'dedupe-peer-dependents': true,
    'dedupe-direct-deps': false,
    'dedupe-injected-deps': true,
    'disallow-workspace-cycles': false,
    'enable-modules-dir': true,
    'enable-pre-post-scripts': true,
    'exclude-links-from-lockfile': false,
    'extend-node-path': true,
    'fail-if-no-match': false,
    'fetch-retries': 2,
    'fetch-retry-factor': 10,
    'fetch-retry-maxtimeout': 60_000,
    'fetch-retry-mintimeout': 10_000,
    'fetch-timeout': 60_000,
    'force-legacy-deploy': false,
    'git-shallow-hosts': [
      // Follow https://github.com/npm/git/blob/1e1dbd26bd5b87ca055defecc3679777cb480e2a/lib/clone.js#L13-L19
      'github.com',
      'gist.github.com',
      'gitlab.com',
      'bitbucket.com',
      'bitbucket.org',
    ],
    globalconfig: npmDefaults.get().globalconfig,
    'git-branch-lockfile': false,
    hoist: true,
    'hoist-pattern': ['*'],
    'hoist-workspace-packages': true,
    'ignore-workspace-cycles': false,
    'ignore-workspace-root-check': false,
    'optimistic-repeat-install': false,
    'init-package-manager': true,
    'inject-workspace-packages': false,
    'link-workspace-packages': false,
    'lockfile-include-tarball-url': false,
    'manage-package-manager-versions': true,
    'modules-cache-max-age': 7 * 24 * 60, // 7 days
    'dlx-cache-max-age': 24 * 60, // 1 day
    'node-linker': 'isolated',
    'package-lock': npmDefaults['package-lock'],
    pending: false,
    'package-manager-strict': process.env.COREPACK_ENABLE_STRICT !== '0',
    'package-manager-strict-version': false,
    'prefer-workspace-packages': false,
    'public-hoist-pattern': [],
    'recursive-install': true,
    registry: npmDefaults.registry,
    'resolution-mode': 'highest',
    'resolve-peers-from-workspace-root': true,
    'save-peer': false,
    'save-workspace-protocol': 'rolling',
    'scripts-prepend-node-path': false,
    'strict-dep-builds': false,
    'side-effects-cache': true,
    symlink: true,
    'shared-workspace-lockfile': true,
    'shell-emulator': false,
    'strict-store-pkg-content-check': true,
    reverse: false,
    sort: true,
    'strict-peer-dependencies': false,
    'unsafe-perm': npmDefaults['unsafe-perm'],
    'use-beta-cli': false,
    userconfig: npmDefaults.userconfig,
    'verify-deps-before-run': false,
    'verify-store-integrity': true,
    'virtual-store-dir': 'node_modules/.ospm',
    'workspace-concurrency': 4,
    'workspace-prefix': opts.workspaceDir,
    'embed-readme': false,
    'registry-supports-time-field': false,
    'virtual-store-dir-max-length': isWindows() ? 60 : 120,
    'peers-suffix-max-length': 1000,
  };

  const {
    config: npmConfig,
    warnings,
    failedToLoadBuiltInConfig,
  } = loadNpmConf(cliOptions, rcOptionsTypes, defaultOptions);

  const configDir = getConfigDir(process);

  {
    const warn = npmConfig.addFile(path.join(configDir, 'rc'), 'ospm-global');

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (warn) {
      warnings.push(warn);
    }
  }

  {
    const warn = npmConfig.addFile(
      path.resolve(path.join(__dirname, 'ospmrc')),
      'ospm-builtin'
    );

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (warn) {
      warnings.push(warn);
    }
  }

  // biome-ignore lint/performance/noDelete: <explanation>
  delete cliOptions.prefix;

  process.execPath = originalExecPath;

  const rcOptions = Object.keys(rcOptionsTypes);

  const configFromCliOpts = Object.fromEntries(
    Object.entries(cliOptions)
      .filter(([_, value]: [string, unknown]): boolean => {
        return typeof value !== 'undefined';
      })
      .map(([name, value]: [string, unknown]): [string, unknown] => {
        return [camelcase(name, { locale: 'en-US' }), value];
      })
  );

  const ospmConfig: ConfigWithDeprecatedSettings = Object.assign(
    Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rcOptions.map((configKey: string): [string, any] => {
        return [
          camelcase(configKey, { locale: 'en-US' }),
          npmConfig.get(configKey),
        ];
      })
    ),
    configFromCliOpts
  ) as unknown as ConfigWithDeprecatedSettings;

  // Resolving the current working directory to its actual location is crucial.
  // This prevents potential inconsistencies in the future, especially when processing or mapping subdirectories.
  const cwd = fs.realpathSync(
    betterPathResolve(cliOptions.dir ?? npmConfig.localPrefix)
  ) as WorkspaceDir;

  ospmConfig.maxSockets = npmConfig.maxsockets;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  // biome-ignore lint/performance/noDelete: <explanation>
  delete ospmConfig.maxsockets;

  ospmConfig.configDir = configDir;
  ospmConfig.workspaceDir = opts.workspaceDir;
  ospmConfig.workspaceRoot = cliOptions['workspace-root']; // This is needed to prevent ospm reading workspaceRoot from env variables
  ospmConfig.rawLocalConfig = Object.assign.apply(Object, [
    {},
    ...npmConfig.list
      .slice(
        3,
        typeof ospmConfig.workspaceDir === 'string' &&
          ospmConfig.workspaceDir !== cwd
          ? 5
          : 4
      )
      .reverse(),
    cliOptions,
  ]);

  ospmConfig.userAgent =
    typeof ospmConfig.rawLocalConfig['user-agent'] === 'string'
      ? ospmConfig.rawLocalConfig['user-agent']
      : `${packageManager.name}/${packageManager.version} npm/? node/${process.version} ${process.platform} ${process.arch}`;

  ospmConfig.rawConfig = Object.assign.apply(Object, [
    { registry: 'https://registry.npmjs.org/' },
    ...[...npmConfig.list].reverse(),
    cliOptions,
    { 'user-agent': ospmConfig.userAgent },
  ]);

  const networkConfigs = getNetworkConfigs(ospmConfig.rawConfig);

  ospmConfig.registries = {
    default: normalizeRegistryUrl(ospmConfig.rawConfig.registry),
    ...networkConfigs.registries,
  };

  ospmConfig.sslConfigs = networkConfigs.sslConfigs;

  ospmConfig.useLockfile = (() => {
    if (typeof ospmConfig.lockfile === 'boolean') {
      return ospmConfig.lockfile;
    }

    if (typeof ospmConfig.packageLock === 'boolean') {
      return ospmConfig.packageLock;
    }

    return false;
  })();

  ospmConfig.useGitBranchLockfile = (() => {
    if (typeof ospmConfig.gitBranchLockfile === 'boolean')
      return ospmConfig.gitBranchLockfile;
    return false;
  })();

  ospmConfig.mergeGitBranchLockfiles = await (async () => {
    if (typeof ospmConfig.mergeGitBranchLockfiles === 'boolean') {
      return ospmConfig.mergeGitBranchLockfiles;
    }
    if (
      ospmConfig.mergeGitBranchLockfilesBranchPattern != null &&
      ospmConfig.mergeGitBranchLockfilesBranchPattern.length > 0
    ) {
      const branch = await getCurrentBranch();

      if (typeof branch === 'string') {
        const branchMatcher = createMatcher(
          ospmConfig.mergeGitBranchLockfilesBranchPattern
        );

        return branchMatcher(branch);
      }
    }

    return undefined;
  })();

  ospmConfig.ospmHomeDir = getDataDir(process);

  const globalDirRoot =
    typeof ospmConfig.globalDir === 'string'
      ? ospmConfig.globalDir
      : path.join(ospmConfig.ospmHomeDir, 'global');

  ospmConfig.globalPkgDir = path.join(
    globalDirRoot,
    LAYOUT_VERSION.toString()
  ) as GlobalPkgDir;

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (cliOptions.global) {
    ospmConfig.dir = ospmConfig.globalPkgDir;

    ospmConfig.bin = npmConfig.get('global-bin-dir') ?? env.OSPM_HOME;

    if (ospmConfig.bin) {
      fs.mkdirSync(ospmConfig.bin, { recursive: true });

      await checkGlobalBinDir(ospmConfig.bin, {
        env,
        shouldAllowWrite: opts.globalDirShouldAllowWrite,
      });
    }

    ospmConfig.save = true;
    ospmConfig.allowNew = true;
    ospmConfig.ignoreCurrentPrefs = true;
    ospmConfig.saveProd = true;
    ospmConfig.saveDev = false;
    ospmConfig.saveOptional = false;
    if (
      ospmConfig.hoistPattern != null &&
      (ospmConfig.hoistPattern.length > 1 || ospmConfig.hoistPattern[0] !== '*')
    ) {
      if (opts.cliOptions?.['hoist-pattern']) {
        throw new OspmError(
          'CONFIG_CONFLICT_HOIST_PATTERN_WITH_GLOBAL',
          'Configuration conflict. "hoist-pattern" may not be used with "global"'
        );
      }
    }
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (ospmConfig.linkWorkspacePackages) {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['link-workspace-packages']) {
        throw new OspmError(
          'CONFIG_CONFLICT_LINK_WORKSPACE_PACKAGES_WITH_GLOBAL',
          'Configuration conflict. "link-workspace-packages" may not be used with "global"'
        );
      }

      ospmConfig.linkWorkspacePackages = false;
    }

    if (ospmConfig.sharedWorkspaceLockfile === true) {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['shared-workspace-lockfile']) {
        throw new OspmError(
          'CONFIG_CONFLICT_SHARED_WORKSPACE_LOCKFILE_WITH_GLOBAL',
          'Configuration conflict. "shared-workspace-lockfile" may not be used with "global"'
        );
      }

      ospmConfig.sharedWorkspaceLockfile = false;
    }

    if (typeof ospmConfig.lockfileDir === 'string') {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['lockfile-dir']) {
        throw new OspmError(
          'CONFIG_CONFLICT_LOCKFILE_DIR_WITH_GLOBAL',
          'Configuration conflict. "lockfile-dir" may not be used with "global"'
        );
      }

      // @ts-expect-error The operand of a 'delete' operator must be optional.ts(2790)

      // biome-ignore lint/performance/noDelete: <explanation>
      delete ospmConfig.lockfileDir;
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions?.['virtual-store-dir']) {
      throw new OspmError(
        'CONFIG_CONFLICT_VIRTUAL_STORE_DIR_WITH_GLOBAL',
        'Configuration conflict. "virtual-store-dir" may not be used with "global"'
      );
    }

    ospmConfig.virtualStoreDir = '.ospm';
  } else {
    ospmConfig.dir = cwd;

    if (!ospmConfig.bin) {
      ospmConfig.bin = path.join(ospmConfig.dir, 'node_modules', '.bin');
    }
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (opts.cliOptions?.['save-peer']) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions['save-prod']) {
      throw new OspmError(
        'CONFIG_CONFLICT_PEER_CANNOT_BE_PROD_DEP',
        'A package cannot be a peer dependency and a prod dependency at the same time'
      );
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions['save-optional']) {
      throw new OspmError(
        'CONFIG_CONFLICT_PEER_CANNOT_BE_OPTIONAL_DEP',
        'A package cannot be a peer dependency and an optional dependency at the same time'
      );
    }
  }

  if (
    ospmConfig.sharedWorkspaceLockfile === true &&
    typeof ospmConfig.lockfileDir !== 'string' &&
    typeof ospmConfig.workspaceDir === 'string'
  ) {
    ospmConfig.lockfileDir = ospmConfig.workspaceDir as unknown as LockFileDir;
  }

  ospmConfig.packageManager = packageManager;

  if (
    ospmConfig.only === 'prod' ||
    ospmConfig.only === 'production' ||
    (!ospmConfig.only && ospmConfig.production === true)
  ) {
    ospmConfig.production = true;
    ospmConfig.dev = false;
  } else if (
    ospmConfig.only === 'dev' ||
    ospmConfig.only === 'development' ||
    ospmConfig.dev === true
  ) {
    ospmConfig.production = false;
    ospmConfig.dev = true;
    ospmConfig.optional = false;
  } else {
    ospmConfig.production = true;
    ospmConfig.dev = true;
  }

  if (typeof ospmConfig.filter === 'string') {
    ospmConfig.filter = ospmConfig.filter.split(' ');
  }

  if (typeof ospmConfig.filterProd === 'string') {
    ospmConfig.filterProd = ospmConfig.filterProd.split(' ');
  }

  ospmConfig.extraBinPaths =
    ospmConfig.ignoreScripts !== true &&
    typeof ospmConfig.workspaceDir === 'string'
      ? [path.join(ospmConfig.workspaceDir, 'node_modules', '.bin')]
      : [];

  ospmConfig.extraEnv = {
    npm_config_verify_deps_before_run: 'false',
  };

  if (ospmConfig.preferSymlinkedExecutables === true && !isWindows()) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const cwd = ospmConfig.lockfileDir || ospmConfig.dir;

    const virtualStoreDir =
      typeof ospmConfig.virtualStoreDir === 'string'
        ? ospmConfig.virtualStoreDir
        : typeof ospmConfig.modulesDir === 'string'
          ? path.join(ospmConfig.modulesDir, '.ospm')
          : 'node_modules/.ospm';

    ospmConfig.extraEnv['NODE_PATH'] = pathAbsolute(
      path.join(virtualStoreDir, 'node_modules'),
      cwd
    );
  }

  if (ospmConfig.shamefullyFlatten === true) {
    warnings.push(
      'The "shamefully-flatten" setting has been renamed to "shamefully-hoist". Also, in most cases you won\'t need "shamefully-hoist". Since v4, a semistrict node_modules structure is on by default (via hoist-pattern=[*]).'
    );

    ospmConfig.shamefullyHoist = true;
  }

  if (!ospmConfig.cacheDir) {
    ospmConfig.cacheDir = getCacheDir(process);
  }

  if (!ospmConfig.stateDir) {
    ospmConfig.stateDir = getStateDir(process);
  }

  if (ospmConfig.hoist === false) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete ospmConfig.hoistPattern;
  }

  switch (ospmConfig.shamefullyHoist) {
    case false: {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete ospmConfig.publicHoistPattern;

      break;
    }

    case true: {
      ospmConfig.publicHoistPattern = ['*'];

      break;
    }

    default: {
      if (
        ospmConfig.publicHoistPattern == null ||
        ospmConfig.publicHoistPattern === '' ||
        (Array.isArray(ospmConfig.publicHoistPattern) &&
          ospmConfig.publicHoistPattern.length === 1 &&
          ospmConfig.publicHoistPattern[0] === '')
      ) {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete ospmConfig.publicHoistPattern;
      }

      break;
    }
  }

  if (!ospmConfig.symlink) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete ospmConfig.hoistPattern;
    // biome-ignore lint/performance/noDelete: <explanation>
    delete ospmConfig.publicHoistPattern;
  }

  if (typeof ospmConfig['color'] === 'boolean') {
    switch (ospmConfig['color']) {
      case true:
        ospmConfig.color = 'always';
        break;
      case false:
        ospmConfig.color = 'never';
        break;
      default:
        ospmConfig.color = 'auto';
        break;
    }
  }

  if (typeof ospmConfig.httpsProxy === 'undefined') {
    ospmConfig.httpsProxy = ospmConfig.proxy ?? getProcessEnv('https_proxy');
  }

  if (typeof ospmConfig.httpProxy === 'undefined') {
    ospmConfig.httpProxy =
      ospmConfig.httpsProxy ??
      getProcessEnv('http_proxy') ??
      getProcessEnv('proxy');
  }

  if (
    typeof ospmConfig.noProxy === 'undefined' ||
    ospmConfig.noProxy === false
  ) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    ospmConfig.noProxy = ospmConfig['noproxy'] ?? getProcessEnv('no_proxy');
  }

  switch (ospmConfig.nodeLinker) {
    case 'pnp': {
      ospmConfig.enablePnp = true;

      break;
    }

    case 'hoisted': {
      if (ospmConfig.preferSymlinkedExecutables == null) {
        ospmConfig.preferSymlinkedExecutables = true;
      }

      break;
    }
  }

  if (!ospmConfig.userConfig) {
    ospmConfig.userConfig = npmConfig.sources.user?.data;
  }

  ospmConfig.sideEffectsCacheRead =
    ospmConfig.sideEffectsCache ?? ospmConfig.sideEffectsCacheReadonly;
  ospmConfig.sideEffectsCacheWrite = ospmConfig.sideEffectsCache;

  if (opts.checkUnknownSetting === true) {
    const settingKeys = Object.keys({
      ...npmConfig.sources?.workspace?.data,
      ...npmConfig.sources?.project?.data,
    }).filter((key: string): boolean => {
      return key.trim() !== '';
    });

    const unknownKeys = [];

    for (const key of settingKeys) {
      if (
        !rcOptions.includes(key) &&
        !key.startsWith('//') &&
        !(key.startsWith('@') && key.endsWith(':registry'))
      ) {
        unknownKeys.push(key);
      }
    }

    if (unknownKeys.length > 0) {
      warnings.push(
        `Your .npmrc file contains unknown setting: ${unknownKeys.join(', ')}`
      );
    }
  }

  ospmConfig.workspaceConcurrency = getWorkspaceConcurrency(
    ospmConfig.workspaceConcurrency
  );

  if (opts.ignoreLocalSettings !== true) {
    ospmConfig.rootProjectManifestDir =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      ospmConfig.lockfileDir ?? ospmConfig.workspaceDir ?? ospmConfig.dir;

    ospmConfig.rootProjectManifest =
      (await safeReadProjectManifestOnly(ospmConfig.rootProjectManifestDir)) ??
      undefined;

    if (ospmConfig.rootProjectManifest != null) {
      if (
        typeof ospmConfig.rootProjectManifest.workspaces?.length === 'number' &&
        typeof ospmConfig.workspaceDir === 'undefined'
      ) {
        warnings.push(
          'The "workspaces" field in package.json is not supported by ospm. Create a "ospm-workspace.yaml" file instead.'
        );
      }

      if (typeof ospmConfig.rootProjectManifest.packageManager === 'string') {
        ospmConfig.wantedPackageManager = parsePackageManager(
          ospmConfig.rootProjectManifest.packageManager
        );
      }

      if (typeof ospmConfig.rootProjectManifest !== 'undefined') {
        Object.assign<ConfigWithDeprecatedSettings, OptionsFromRootManifest>(
          ospmConfig,
          getOptionsFromRootManifest(
            ospmConfig.rootProjectManifestDir,
            ospmConfig.rootProjectManifest
          )
        );
      }
    }

    if (ospmConfig.workspaceDir != null) {
      const workspaceManifest = await readWorkspaceManifest(
        ospmConfig.workspaceDir
      );

      ospmConfig.workspacePackagePatterns = (cliOptions['workspace-packages'] as
        | string[]
        | undefined) ??
        workspaceManifest?.packages ?? ['.'];

      if (typeof workspaceManifest !== 'undefined') {
        Object.assign(
          ospmConfig,
          getOptionsFromOspmSettings(
            ospmConfig.workspaceDir,
            {},
            ospmConfig.rootProjectManifest
          ),
          configFromCliOpts
        );

        ospmConfig.catalogs =
          getCatalogsFromWorkspaceManifest(workspaceManifest);
      }
    }
  }

  ospmConfig.failedToLoadBuiltInConfig = failedToLoadBuiltInConfig;

  return { config: ospmConfig, warnings };
}

function getProcessEnv(env: string): string | undefined {
  return (
    process.env[env] ??
    process.env[env.toUpperCase()] ??
    process.env[env.toLowerCase()]
  );
}

function parsePackageManager(packageManager: string): {
  name: string;
  version: string | undefined;
} {
  if (!packageManager.includes('@')) {
    return { name: packageManager, version: undefined };
  }

  const [name, pmReference] = packageManager.split('@');

  if (typeof pmReference !== 'string' || typeof name !== 'string') {
    return { name: '', version: undefined };
  }

  // pmReference is semantic versioning, not URL
  if (pmReference.includes(':')) {
    return { name, version: undefined };
  }

  // Remove the integrity hash. Ex: "ospm@9.5.0+sha512.140036830124618d624a2187b50d04289d5a087f326c9edfc0ccd733d76c4f52c3a313d4fc148794a2a9d81553016004e6742e8cf850670268a7387fc220c903"
  const [version] = pmReference.split('+');

  return {
    name,
    version,
  };
}
