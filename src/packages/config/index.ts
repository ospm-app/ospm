import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getCatalogsFromWorkspaceManifest } from '../catalogs.config/index.ts';
import { LAYOUT_VERSION } from '../constants/index.ts';
import { PnpmError } from '../error/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { loadNpmConf, defaults } from '@pnpm/npm-conf';
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
  getOptionsFromPnpmSettings,
  getOptionsFromRootManifest,
  type OptionsFromRootManifest,
} from './getOptionsFromRootManifest.ts';
import process from 'node:process';
import type {
  GlobalPkgDir,
  LockFileDir,
  WorkspaceDir,
} from '../types/index.ts';

export { types };

export {
  getOptionsFromRootManifest,
  getOptionsFromPnpmSettings,
  type OptionsFromRootManifest,
} from './getOptionsFromRootManifest.ts';
export * from './readLocalConfig.ts';

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
    name: 'pnpm',
    version: 'undefined',
  };

  const cliOptions = opts.cliOptions ?? {};

  if (cliOptions.hoist === false) {
    if (cliOptions['shamefully-hoist'] === true) {
      throw new PnpmError(
        'CONFIG_CONFLICT_HOIST',
        '--shamefully-hoist cannot be used with --no-hoist'
      );
    }

    if (cliOptions['shamefully-flatten'] === true) {
      throw new PnpmError(
        'CONFIG_CONFLICT_HOIST',
        '--shamefully-flatten cannot be used with --no-hoist'
      );
    }

    if (typeof cliOptions['hoist-pattern'] !== 'undefined') {
      throw new PnpmError(
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
    'virtual-store-dir': 'node_modules/.pnpm',
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
    const warn = npmConfig.addFile(path.join(configDir, 'rc'), 'pnpm-global');

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (warn) {
      warnings.push(warn);
    }
  }

  {
    const warn = npmConfig.addFile(
      path.resolve(path.join(__dirname, 'pnpmrc')),
      'pnpm-builtin'
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

  const pnpmConfig: ConfigWithDeprecatedSettings = Object.assign(
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

  pnpmConfig.maxSockets = npmConfig.maxsockets;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  // biome-ignore lint/performance/noDelete: <explanation>
  delete pnpmConfig.maxsockets;

  pnpmConfig.configDir = configDir;
  pnpmConfig.workspaceDir = opts.workspaceDir;
  pnpmConfig.workspaceRoot = cliOptions['workspace-root']; // This is needed to prevent pnpm reading workspaceRoot from env variables
  pnpmConfig.rawLocalConfig = Object.assign.apply(Object, [
    {},
    ...npmConfig.list
      .slice(
        3,
        typeof pnpmConfig.workspaceDir === 'string' &&
          pnpmConfig.workspaceDir !== cwd
          ? 5
          : 4
      )
      .reverse(),
    cliOptions,
  ]);

  pnpmConfig.userAgent =
    typeof pnpmConfig.rawLocalConfig['user-agent'] === 'string'
      ? pnpmConfig.rawLocalConfig['user-agent']
      : `${packageManager.name}/${packageManager.version} npm/? node/${process.version} ${process.platform} ${process.arch}`;

  pnpmConfig.rawConfig = Object.assign.apply(Object, [
    { registry: 'https://registry.npmjs.org/' },
    ...[...npmConfig.list].reverse(),
    cliOptions,
    { 'user-agent': pnpmConfig.userAgent },
  ]);

  const networkConfigs = getNetworkConfigs(pnpmConfig.rawConfig);

  pnpmConfig.registries = {
    default: normalizeRegistryUrl(pnpmConfig.rawConfig.registry),
    ...networkConfigs.registries,
  };

  pnpmConfig.sslConfigs = networkConfigs.sslConfigs;

  pnpmConfig.useLockfile = (() => {
    if (typeof pnpmConfig.lockfile === 'boolean') {
      return pnpmConfig.lockfile;
    }

    if (typeof pnpmConfig.packageLock === 'boolean') {
      return pnpmConfig.packageLock;
    }

    return false;
  })();

  pnpmConfig.useGitBranchLockfile = (() => {
    if (typeof pnpmConfig.gitBranchLockfile === 'boolean')
      return pnpmConfig.gitBranchLockfile;
    return false;
  })();

  pnpmConfig.mergeGitBranchLockfiles = await (async () => {
    if (typeof pnpmConfig.mergeGitBranchLockfiles === 'boolean') {
      return pnpmConfig.mergeGitBranchLockfiles;
    }
    if (
      pnpmConfig.mergeGitBranchLockfilesBranchPattern != null &&
      pnpmConfig.mergeGitBranchLockfilesBranchPattern.length > 0
    ) {
      const branch = await getCurrentBranch();

      if (typeof branch === 'string') {
        const branchMatcher = createMatcher(
          pnpmConfig.mergeGitBranchLockfilesBranchPattern
        );

        return branchMatcher(branch);
      }
    }

    return undefined;
  })();

  pnpmConfig.pnpmHomeDir = getDataDir(process);

  const globalDirRoot =
    typeof pnpmConfig.globalDir === 'string'
      ? pnpmConfig.globalDir
      : path.join(pnpmConfig.pnpmHomeDir, 'global');

  pnpmConfig.globalPkgDir = path.join(
    globalDirRoot,
    LAYOUT_VERSION.toString()
  ) as GlobalPkgDir;

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (cliOptions.global) {
    pnpmConfig.dir = pnpmConfig.globalPkgDir;

    pnpmConfig.bin = npmConfig.get('global-bin-dir') ?? env.PNPM_HOME;

    if (pnpmConfig.bin) {
      fs.mkdirSync(pnpmConfig.bin, { recursive: true });

      await checkGlobalBinDir(pnpmConfig.bin, {
        env,
        shouldAllowWrite: opts.globalDirShouldAllowWrite,
      });
    }

    pnpmConfig.save = true;
    pnpmConfig.allowNew = true;
    pnpmConfig.ignoreCurrentPrefs = true;
    pnpmConfig.saveProd = true;
    pnpmConfig.saveDev = false;
    pnpmConfig.saveOptional = false;
    if (
      pnpmConfig.hoistPattern != null &&
      (pnpmConfig.hoistPattern.length > 1 || pnpmConfig.hoistPattern[0] !== '*')
    ) {
      if (opts.cliOptions?.['hoist-pattern']) {
        throw new PnpmError(
          'CONFIG_CONFLICT_HOIST_PATTERN_WITH_GLOBAL',
          'Configuration conflict. "hoist-pattern" may not be used with "global"'
        );
      }
    }
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (pnpmConfig.linkWorkspacePackages) {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['link-workspace-packages']) {
        throw new PnpmError(
          'CONFIG_CONFLICT_LINK_WORKSPACE_PACKAGES_WITH_GLOBAL',
          'Configuration conflict. "link-workspace-packages" may not be used with "global"'
        );
      }

      pnpmConfig.linkWorkspacePackages = false;
    }

    if (pnpmConfig.sharedWorkspaceLockfile === true) {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['shared-workspace-lockfile']) {
        throw new PnpmError(
          'CONFIG_CONFLICT_SHARED_WORKSPACE_LOCKFILE_WITH_GLOBAL',
          'Configuration conflict. "shared-workspace-lockfile" may not be used with "global"'
        );
      }

      pnpmConfig.sharedWorkspaceLockfile = false;
    }

    if (typeof pnpmConfig.lockfileDir === 'string') {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (opts.cliOptions?.['lockfile-dir']) {
        throw new PnpmError(
          'CONFIG_CONFLICT_LOCKFILE_DIR_WITH_GLOBAL',
          'Configuration conflict. "lockfile-dir" may not be used with "global"'
        );
      }

      // @ts-expect-error The operand of a 'delete' operator must be optional.ts(2790)

      // biome-ignore lint/performance/noDelete: <explanation>
      delete pnpmConfig.lockfileDir;
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions?.['virtual-store-dir']) {
      throw new PnpmError(
        'CONFIG_CONFLICT_VIRTUAL_STORE_DIR_WITH_GLOBAL',
        'Configuration conflict. "virtual-store-dir" may not be used with "global"'
      );
    }

    pnpmConfig.virtualStoreDir = '.pnpm';
  } else {
    pnpmConfig.dir = cwd;

    if (!pnpmConfig.bin) {
      pnpmConfig.bin = path.join(pnpmConfig.dir, 'node_modules', '.bin');
    }
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (opts.cliOptions?.['save-peer']) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions['save-prod']) {
      throw new PnpmError(
        'CONFIG_CONFLICT_PEER_CANNOT_BE_PROD_DEP',
        'A package cannot be a peer dependency and a prod dependency at the same time'
      );
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (opts.cliOptions['save-optional']) {
      throw new PnpmError(
        'CONFIG_CONFLICT_PEER_CANNOT_BE_OPTIONAL_DEP',
        'A package cannot be a peer dependency and an optional dependency at the same time'
      );
    }
  }

  if (
    pnpmConfig.sharedWorkspaceLockfile === true &&
    typeof pnpmConfig.lockfileDir !== 'string' &&
    typeof pnpmConfig.workspaceDir === 'string'
  ) {
    pnpmConfig.lockfileDir = pnpmConfig.workspaceDir as unknown as LockFileDir;
  }

  pnpmConfig.packageManager = packageManager;

  if (
    pnpmConfig.only === 'prod' ||
    pnpmConfig.only === 'production' ||
    (!pnpmConfig.only && pnpmConfig.production === true)
  ) {
    pnpmConfig.production = true;
    pnpmConfig.dev = false;
  } else if (
    pnpmConfig.only === 'dev' ||
    pnpmConfig.only === 'development' ||
    pnpmConfig.dev === true
  ) {
    pnpmConfig.production = false;
    pnpmConfig.dev = true;
    pnpmConfig.optional = false;
  } else {
    pnpmConfig.production = true;
    pnpmConfig.dev = true;
  }

  if (typeof pnpmConfig.filter === 'string') {
    pnpmConfig.filter = pnpmConfig.filter.split(' ');
  }

  if (typeof pnpmConfig.filterProd === 'string') {
    pnpmConfig.filterProd = pnpmConfig.filterProd.split(' ');
  }

  pnpmConfig.extraBinPaths =
    pnpmConfig.ignoreScripts !== true &&
    typeof pnpmConfig.workspaceDir === 'string'
      ? [path.join(pnpmConfig.workspaceDir, 'node_modules', '.bin')]
      : [];

  pnpmConfig.extraEnv = {
    npm_config_verify_deps_before_run: 'false',
  };

  if (pnpmConfig.preferSymlinkedExecutables === true && !isWindows()) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const cwd = pnpmConfig.lockfileDir || pnpmConfig.dir;

    const virtualStoreDir =
      typeof pnpmConfig.virtualStoreDir === 'string'
        ? pnpmConfig.virtualStoreDir
        : typeof pnpmConfig.modulesDir === 'string'
          ? path.join(pnpmConfig.modulesDir, '.pnpm')
          : 'node_modules/.pnpm';

    pnpmConfig.extraEnv['NODE_PATH'] = pathAbsolute(
      path.join(virtualStoreDir, 'node_modules'),
      cwd
    );
  }

  if (pnpmConfig.shamefullyFlatten === true) {
    warnings.push(
      'The "shamefully-flatten" setting has been renamed to "shamefully-hoist". Also, in most cases you won\'t need "shamefully-hoist". Since v4, a semistrict node_modules structure is on by default (via hoist-pattern=[*]).'
    );

    pnpmConfig.shamefullyHoist = true;
  }

  if (!pnpmConfig.cacheDir) {
    pnpmConfig.cacheDir = getCacheDir(process);
  }

  if (!pnpmConfig.stateDir) {
    pnpmConfig.stateDir = getStateDir(process);
  }

  if (pnpmConfig.hoist === false) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete pnpmConfig.hoistPattern;
  }

  switch (pnpmConfig.shamefullyHoist) {
    case false: {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete pnpmConfig.publicHoistPattern;

      break;
    }

    case true: {
      pnpmConfig.publicHoistPattern = ['*'];

      break;
    }

    default: {
      if (
        pnpmConfig.publicHoistPattern == null ||
        pnpmConfig.publicHoistPattern === '' ||
        (Array.isArray(pnpmConfig.publicHoistPattern) &&
          pnpmConfig.publicHoistPattern.length === 1 &&
          pnpmConfig.publicHoistPattern[0] === '')
      ) {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete pnpmConfig.publicHoistPattern;
      }

      break;
    }
  }

  if (!pnpmConfig.symlink) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete pnpmConfig.hoistPattern;
    // biome-ignore lint/performance/noDelete: <explanation>
    delete pnpmConfig.publicHoistPattern;
  }

  if (typeof pnpmConfig['color'] === 'boolean') {
    switch (pnpmConfig['color']) {
      case true:
        pnpmConfig.color = 'always';
        break;
      case false:
        pnpmConfig.color = 'never';
        break;
      default:
        pnpmConfig.color = 'auto';
        break;
    }
  }

  if (typeof pnpmConfig.httpsProxy === 'undefined') {
    pnpmConfig.httpsProxy = pnpmConfig.proxy ?? getProcessEnv('https_proxy');
  }

  if (typeof pnpmConfig.httpProxy === 'undefined') {
    pnpmConfig.httpProxy =
      pnpmConfig.httpsProxy ??
      getProcessEnv('http_proxy') ??
      getProcessEnv('proxy');
  }

  if (
    typeof pnpmConfig.noProxy === 'undefined' ||
    pnpmConfig.noProxy === false
  ) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    pnpmConfig.noProxy = pnpmConfig['noproxy'] ?? getProcessEnv('no_proxy');
  }

  switch (pnpmConfig.nodeLinker) {
    case 'pnp': {
      pnpmConfig.enablePnp = true;

      break;
    }

    case 'hoisted': {
      if (pnpmConfig.preferSymlinkedExecutables == null) {
        pnpmConfig.preferSymlinkedExecutables = true;
      }

      break;
    }
  }

  if (!pnpmConfig.userConfig) {
    pnpmConfig.userConfig = npmConfig.sources.user?.data;
  }

  pnpmConfig.sideEffectsCacheRead =
    pnpmConfig.sideEffectsCache ?? pnpmConfig.sideEffectsCacheReadonly;
  pnpmConfig.sideEffectsCacheWrite = pnpmConfig.sideEffectsCache;

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

  pnpmConfig.workspaceConcurrency = getWorkspaceConcurrency(
    pnpmConfig.workspaceConcurrency
  );

  if (opts.ignoreLocalSettings !== true) {
    pnpmConfig.rootProjectManifestDir =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      pnpmConfig.lockfileDir ?? pnpmConfig.workspaceDir ?? pnpmConfig.dir;

    pnpmConfig.rootProjectManifest =
      (await safeReadProjectManifestOnly(pnpmConfig.rootProjectManifestDir)) ??
      undefined;

    if (pnpmConfig.rootProjectManifest != null) {
      if (
        typeof pnpmConfig.rootProjectManifest.workspaces?.length === 'number' &&
        typeof pnpmConfig.workspaceDir === 'undefined'
      ) {
        warnings.push(
          'The "workspaces" field in package.json is not supported by pnpm. Create a "pnpm-workspace.yaml" file instead.'
        );
      }

      if (typeof pnpmConfig.rootProjectManifest.packageManager === 'string') {
        pnpmConfig.wantedPackageManager = parsePackageManager(
          pnpmConfig.rootProjectManifest.packageManager
        );
      }

      if (typeof pnpmConfig.rootProjectManifest !== 'undefined') {
        Object.assign<ConfigWithDeprecatedSettings, OptionsFromRootManifest>(
          pnpmConfig,
          getOptionsFromRootManifest(
            pnpmConfig.rootProjectManifestDir,
            pnpmConfig.rootProjectManifest
          )
        );
      }
    }

    if (pnpmConfig.workspaceDir != null) {
      const workspaceManifest = await readWorkspaceManifest(
        pnpmConfig.workspaceDir
      );

      pnpmConfig.workspacePackagePatterns = (cliOptions['workspace-packages'] as
        | string[]
        | undefined) ??
        workspaceManifest?.packages ?? ['.'];

      if (workspaceManifest) {
        Object.assign(
          pnpmConfig,
          getOptionsFromPnpmSettings(
            pnpmConfig.workspaceDir,
            workspaceManifest,
            pnpmConfig.rootProjectManifest
          ),
          configFromCliOpts
        );

        pnpmConfig.catalogs =
          getCatalogsFromWorkspaceManifest(workspaceManifest);
      }
    }
  }

  pnpmConfig.failedToLoadBuiltInConfig = failedToLoadBuiltInConfig;

  return { config: pnpmConfig, warnings };
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

  // Remove the integrity hash. Ex: "pnpm@9.5.0+sha512.140036830124618d624a2187b50d04289d5a087f326c9edfc0ccd733d76c4f52c3a313d4fc148794a2a9d81553016004e6742e8cf850670268a7387fc220c903"
  const [version] = pmReference.split('+');

  return {
    name,
    version,
  };
}
