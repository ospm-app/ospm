import type { Config } from '../config/index.ts';
import type { Log } from '../core-loggers/index.ts';
import { renderDedupeCheckIssues } from '../dedupe.issues-renderer/index.ts';
import type { DedupeCheckIssues } from '../dedupe.types/index.ts';
import type { OspmError } from '../error/index.ts';
import { renderPeerIssues } from '../render-peer-issues/index.ts';
import type {
  PeerDependencyRules,
  PeerDependencyIssuesByProjects,
  ModulesDir,
} from '../types/index.ts';
import chalk from 'chalk';
import equals from 'ramda/src/equals';
import StackTracey from 'stacktracey';
import { EOL } from './constants.ts';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// Property 'maxColumnWidths' does not exist on type 'typeof StackTracey'.ts(2339)
StackTracey.maxColumnWidths = {
  callee: 25,
  file: 350,
  sourceLine: 25,
};

const highlight = chalk.yellow;
const colorPath = chalk.gray;

export function reportError(
  logObj: Log,
  config?: Config | undefined,
  peerDependencyRules?: PeerDependencyRules | undefined
): string | null {
  const errorInfo = getErrorInfo(logObj, config, peerDependencyRules);

  if (!errorInfo) {
    return null;
  }

  let output = formatErrorSummary(
    errorInfo.title,
    (logObj as LogObjWithPossibleError).err?.code
  );

  if (logObj.pkgsStack != null) {
    if (logObj.pkgsStack.length > 0) {
      output += `\n\n${formatPkgsStack(logObj.pkgsStack)}`;
    } else if ('prefix' in logObj && typeof logObj.prefix !== 'undefined') {
      output += `\n\nThis error happened while installing a direct dependency of ${logObj.prefix}`;
    }
  }

  if (typeof errorInfo.body !== 'undefined') {
    output += `\n\n${errorInfo.body}`;
  }

  return output;

  /**
   * A type to assist with introspection of the logObj.
   * These objects may or may not have an `err` field.
   */
  type LogObjWithPossibleError = {
    readonly err?: { code?: string | undefined } | undefined;
  };
}

type ErrorInfo = {
  title: string;
  body?: string | undefined;
};

function getErrorInfo(
  logObj: Log,
  config?: Config | undefined,
  peerDependencyRules?: PeerDependencyRules | undefined
): ErrorInfo | null {
  if ('err' in logObj && logObj.err) {
    const err = logObj.err as OspmError & { stack: object };

    switch (err.code) {
      case 'ERR_OSPM_UNEXPECTED_STORE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportUnexpectedStore(err, logObj as any);
      }

      case 'ERR_OSPM_UNEXPECTED_VIRTUAL_STORE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportUnexpectedVirtualStoreDir(err, logObj as any);
      }

      case 'ERR_OSPM_STORE_BREAKING_CHANGE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportStoreBreakingChange(logObj as any);
      }

      case 'ERR_OSPM_MODULES_BREAKING_CHANGE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportModulesBreakingChange(logObj as any);
      }

      case 'ERR_OSPM_MODIFIED_DEPENDENCY': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportModifiedDependency(logObj as any);
      }

      case 'ERR_OSPM_LOCKFILE_BREAKING_CHANGE': {
        return reportLockfileBreakingChange(err, logObj);
      }

      case 'ERR_OSPM_RECURSIVE_RUN_NO_SCRIPT': {
        return { title: err.message };
      }

      case 'ERR_OSPM_MISSING_TIME': {
        return {
          title: err.message,
          body: 'If you cannot fix this registry issue, then set "resolution-mode" to "highest".',
        };
      }

      case 'ERR_OSPM_NO_MATCHING_VERSION': {
        return formatNoMatchingVersion(
          err,
          logObj as unknown as { packageMeta: PackageMeta }
        );
      }

      case 'ERR_OSPM_RECURSIVE_FAIL': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return formatRecursiveCommandSummary(logObj as any);
      }

      case 'ERR_OSPM_BAD_TARBALL_SIZE': {
        return reportBadTarballSize(err, logObj);
      }

      case 'ELIFECYCLE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportLifecycleError(logObj as any);
      }

      case 'ERR_OSPM_UNSUPPORTED_ENGINE': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportEngineError(logObj as any);
      }

      case 'ERR_OSPM_PEER_DEP_ISSUES': {
        return reportPeerDependencyIssuesError(
          err,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          logObj as any,
          peerDependencyRules
        );
      }

      case 'ERR_OSPM_DEDUPE_CHECK_ISSUES': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportDedupeCheckIssuesError(err, logObj as any);
      }

      case 'ERR_OSPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportSpecNotSupportedByAnyResolverError(err, logObj as any);
      }

      case 'ERR_OSPM_FETCH_401':
      case 'ERR_OSPM_FETCH_403': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reportAuthError(err, logObj as any, config);
      }

      default: {
        // Errors with unknown error codes are printed with stack trace
        if (!err.code.startsWith('ERR_OSPM_')) {
          return formatGenericError(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            err.message ?? (logObj as { message: string }).message,
            err.stack
          );
        }

        return {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          title: err.message ?? '',
          body: (logObj as { hint?: string }).hint,
        };
      }
    }
  }

  return { title: logObj.message ?? '' };
}

interface PkgStackItem {
  readonly id: string;
  readonly name: string;
  // The version may be missing if this was a private workspace package without
  // the version field set.
  readonly version?: string | undefined;
}

function formatPkgNameVer({ name, version }: PkgStackItem): string {
  return version == null ? name : `${name}@${version}`;
}

function formatPkgsStack(pkgsStack: readonly PkgStackItem[]): string {
  return `This error happened while installing the dependencies of \
${formatPkgNameVer(pkgsStack[0] as PkgStackItem)}\
${pkgsStack
  .slice(1)
  .map((pkgInfo) => `${EOL} at ${formatPkgNameVer(pkgInfo)}`)
  .join('')}`;
}

interface PackageMeta {
  name: string;
  'dist-tags': Record<string, string> & {
    latest: string;
  };
  versions: Record<string, object>;
}

function formatNoMatchingVersion(
  err: Error,
  msg: { packageMeta: PackageMeta }
): {
  title: string;
  body: string;
} {
  const meta: PackageMeta = msg.packageMeta;

  let output = `The latest release of ${meta.name} is "${meta['dist-tags'].latest}".${EOL}`;

  if (!equals.default(Object.keys(meta['dist-tags']), ['latest'])) {
    output += `${EOL}Other releases are: ${EOL}`;

    for (const tag in meta['dist-tags']) {
      if (tag !== 'latest') {
        output += `  * ${tag}: ${meta['dist-tags'][tag]}${EOL}`;
      }
    }
  }

  output += `${EOL}If you need the full list of all ${Object.keys(meta.versions).length} published versions run "$ ospm view ${meta.name} versions".`;

  return {
    title: err.message,
    body: output,
  };
}

function reportUnexpectedStore(
  err: Error,
  msg: {
    actualStorePath: string;
    expectedStorePath: string;
    modulesDir: ModulesDir;
  }
): ErrorInfo {
  return {
    title: err.message,
    body: `The dependencies at "${msg.modulesDir}" are currently linked from the store at "${msg.expectedStorePath}".

ospm now wants to use the store at "${msg.actualStorePath}" to link dependencies.

If you want to use the new store location, reinstall your dependencies with "ospm install".

You may change the global store location by running "ospm config set store-dir <dir> --global".
(This error may happen if the node_modules was installed with a different major version of ospm)`,
  };
}

function reportUnexpectedVirtualStoreDir(
  err: Error,
  msg: {
    actual: string;
    expected: string;
    modulesDir: ModulesDir;
  }
): ErrorInfo {
  return {
    title: err.message,
    body: `The dependencies at "${msg.modulesDir}" are currently symlinked from the virtual store directory at "${msg.expected}".

ospm now wants to use the virtual store at "${msg.actual}" to link dependencies from the store.

If you want to use the new virtual store location, reinstall your dependencies with "ospm install".

You may change the virtual store location by changing the value of the virtual-store-dir config.`,
  };
}

function reportStoreBreakingChange(msg: {
  additionalInformation?: string | undefined;
  storePath: string;
  relatedIssue?: number | undefined;
  relatedPR?: number | undefined;
}): ErrorInfo {
  let output = `Store path: ${colorPath(msg.storePath)}

Run "ospm install" to recreate node_modules.`;

  if (typeof msg.additionalInformation === 'string') {
    output = `${output}${EOL}${EOL}${msg.additionalInformation}`;
  }

  output += formatRelatedSources(msg);
  return {
    title:
      'The store used for the current node_modules is incompatible with the current version of ospm',
    body: output,
  };
}

function reportModulesBreakingChange(msg: {
  additionalInformation?: string;
  modulesPath: string;
  relatedIssue?: number;
  relatedPR?: number;
}): ErrorInfo {
  let output = `node_modules path: ${colorPath(msg.modulesPath)}

Run ${highlight('ospm install')} to recreate node_modules.`;

  if (typeof msg.additionalInformation === 'string') {
    output = `${output}${EOL}${EOL}${msg.additionalInformation}`;
  }

  output += formatRelatedSources(msg);

  return {
    title:
      'The current version of ospm is not compatible with the available node_modules structure',
    body: output,
  };
}

function formatRelatedSources(msg: {
  relatedIssue?: number | undefined;
  relatedPR?: number | undefined;
}): string {
  let output = '';

  if (
    typeof msg.relatedIssue === 'undefined' &&
    typeof msg.relatedPR === 'undefined'
  ) {
    return output;
  }

  output += EOL;

  if (typeof msg.relatedIssue === 'number') {
    output += `${EOL}Related issue: ${colorPath(`https://github.com/ospm/ospm/issues/${msg.relatedIssue}`)}`;
  }

  if (typeof msg.relatedPR === 'number') {
    output += `${EOL}Related PR: ${colorPath(`https://github.com/ospm/ospm/pull/${msg.relatedPR}`)}`;
  }

  return output;
}

function formatGenericError(
  errorMessage: string,
  stack: Error | string
): ErrorInfo {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (stack) {
    let prettyStack: string | undefined;
    try {
      prettyStack = new StackTracey(stack).asTable();
    } catch {
      prettyStack = stack.toString();
    }
    if (prettyStack) {
      return {
        title: errorMessage,
        body: prettyStack,
      };
    }
  }
  return { title: errorMessage };
}

function formatErrorSummary(message: string, code?: string): string {
  return `${chalk.bgRed.black(`\u2009${code ?? 'ERROR'}\u2009`)} ${chalk.red(message)}`;
}

function reportModifiedDependency(msg: { modified: string[] }): ErrorInfo {
  return {
    title: 'Packages in the store have been mutated',
    body: `These packages are modified:
${msg.modified.map((pkgPath: string) => colorPath(pkgPath)).join(EOL)}

You can run ${highlight('ospm install --force')} to refetch the modified packages`,
  };
}

function reportLockfileBreakingChange(err: Error, _msg: object): ErrorInfo {
  return {
    title: err.message,
    body: `Run with the ${highlight('--force')} parameter to recreate the lockfile.`,
  };
}

function formatRecursiveCommandSummary(msg: {
  failures: Array<Error & { prefix: string }>;
  passes: number;
}): ErrorInfo {
  const output = `${EOL}Summary: ${chalk.red(`${msg.failures.length} fails`)}, ${msg.passes} passes${EOL}${EOL}${msg.failures
    .map(({ message, prefix }): string => {
      return `${prefix}:${EOL}${formatErrorSummary(message)}`;
    })
    .join(EOL + EOL)}`;
  return {
    title: '',
    body: output,
  };
}

function reportBadTarballSize(err: Error, _msg: object): ErrorInfo {
  return {
    title: err.message,
    body: `Seems like you have internet connection issues.
Try running the same command again.
If that doesn't help, try one of the following:

- Set a bigger value for the \`fetch-retries\` config.
    To check the current value of \`fetch-retries\`, run \`ospm get fetch-retries\`.
    To set a new value, run \`ospm set fetch-retries <number>\`.

- Set \`network-concurrency\` to 1.
    This change will slow down installation times, so it is recommended to
    delete the config once the internet connection is good again: \`ospm config delete network-concurrency\`

NOTE: You may also override configs via flags.
For instance, \`ospm install --fetch-retries 5 --network-concurrency 1\``,
  };
}

function reportLifecycleError(msg: {
  stage: string;
  errno?: number | string;
}): ErrorInfo {
  if (msg.stage === 'test') {
    return { title: 'Test failed. See above for more details.' };
  }

  if (typeof msg.errno === 'number') {
    return { title: `Command failed with exit code ${msg.errno}.` };
  }

  return { title: 'Command failed.' };
}

function reportEngineError(msg: {
  message: string;
  current: {
    node: string;
    ospm: string;
  };
  packageId: string;
  wanted: {
    node?: string | undefined;
    ospm?: string | undefined;
  };
}): ErrorInfo {
  let output = '';

  if (typeof msg.wanted.ospm === 'string') {
    output += `\
Your ospm version is incompatible with "${msg.packageId}".

Expected version: ${msg.wanted.ospm}
Got: ${msg.current.ospm}

This is happening because the package's manifest has an engines.ospm field specified.
To fix this issue, install the required ospm version globally.

To install the latest version of ospm, run "ospm i -g ospm".
To check your ospm version, run "ospm -v".`;
  }
  if (typeof msg.wanted.node === 'string') {
    if (output) output += EOL + EOL;
    output += `\
Your Node version is incompatible with "${msg.packageId}".

Expected version: ${msg.wanted.node}
Got: ${msg.current.node}

This is happening because the package's manifest has an engines.node field specified.
To fix this issue, install the required Node version.`;
  }
  return {
    title: 'Unsupported environment (bad ospm and/or Node.js version)',
    body: output,
  };
}

function reportAuthError(
  err: Error,
  msg: { hint?: string | undefined },
  config?: Config | undefined
): ErrorInfo {
  const foundSettings = [] as string[];

  for (const [key, value] of Object.entries(config?.rawConfig ?? {})) {
    if (key[0] === '@') {
      foundSettings.push(`${key}=${String(value)}`);
      continue;
    }

    if (
      key.endsWith('_auth') ||
      key.endsWith('_authToken') ||
      key.endsWith('username') ||
      key.endsWith('_password')
    ) {
      foundSettings.push(`${key}=${hideSecureInfo(key, value)}`);
    }
  }

  let output = typeof msg.hint === 'string' ? `${msg.hint}${EOL}${EOL}` : '';

  if (foundSettings.length === 0) {
    output += `No authorization settings were found in the configs.
Try to log in to the registry by running "ospm login"
or add the auth tokens manually to the ~/.npmrc file.`;
  } else {
    output += `These authorization settings were found:
${foundSettings.join('\n')}`;
  }

  return {
    title: err.message,
    body: output,
  };
}

function hideSecureInfo(key: string, value: string): string {
  if (key.endsWith('_password')) {
    return '[hidden]';
  }

  if (key.endsWith('_auth') || key.endsWith('_authToken')) {
    return `${value.substring(0, 4)}[hidden]`;
  }

  return value;
}

function reportPeerDependencyIssuesError(
  err: Error,
  msg: { issuesByProjects: PeerDependencyIssuesByProjects },
  peerDependencyRules?: PeerDependencyRules | undefined
): ErrorInfo | null {
  const hasMissingPeers = getHasMissingPeers(msg.issuesByProjects);

  const hints: string[] = [];

  if (hasMissingPeers) {
    hints.push(
      'If you want peer dependencies to be automatically installed, add "auto-install-peers=true" to an .npmrc file at the root of your project.'
    );
  }

  hints.push(
    'If you don\'t want ospm to fail on peer dependency issues, add "strict-peer-dependencies=false" to an .npmrc file at the root of your project.'
  );

  const rendered = renderPeerIssues(msg.issuesByProjects, {
    rules: peerDependencyRules,
  });

  if (!rendered) {
    return null;
  }

  return {
    title: err.message,
    body: `${rendered}
${hints.map((hint) => `hint: ${hint}`).join('\n')}
`,
  };
}

function getHasMissingPeers(
  issuesByProjects: PeerDependencyIssuesByProjects
): boolean {
  return Object.values(issuesByProjects).some((issues) =>
    Object.values(issues.missing)
      .flat()
      .some(({ optional }) => !optional)
  );
}

function reportDedupeCheckIssuesError(
  err: Error,
  msg: { dedupeCheckIssues: DedupeCheckIssues }
): ErrorInfo {
  return {
    title: err.message,
    body: `\
${renderDedupeCheckIssues(msg.dedupeCheckIssues)}
Run ${chalk.yellow('ospm dedupe')} to apply the changes above.
`,
  };
}

function reportSpecNotSupportedByAnyResolverError(
  err: Error,
  logObj: Log
): ErrorInfo {
  // If the catalog protocol specifier was sent to a "real resolver", it'll
  // eventually throw a "specifier not supported" error since the catalog
  // protocol is meant to be replaced before it's passed to any of the real
  // resolvers.
  //
  // If this kind of error is thrown, and the dependency pref is using the
  // catalog protocol it's most likely because we're trying to install an out of
  // repo dependency that was published incorrectly. For example, it may be been
  // mistakenly published with 'npm publish' instead of 'ospm publish'. Report a
  // more clear error in this case.
  if (logObj.package?.pref?.startsWith('catalog:') === true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return reportExternalCatalogProtocolError(err, logObj as any);
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    title: err.message ?? '',
    body: logObj.hint,
  };
}

function reportExternalCatalogProtocolError(
  err: Error,
  logObj: Log
): ErrorInfo {
  const { pkgsStack } = logObj;
  const problemDep = pkgsStack?.[0];

  let body = `\
An external package outside of the ospm workspace declared a dependency using
the catalog protocol. This is likely a bug in that external package. Only
packages within the ospm workspace may use catalogs. Usages of the catalog
protocol are replaced with real specifiers on 'ospm publish'.
`;

  if (problemDep != null) {
    body += `\

This is likely a bug in the publishing automation of this package. Consider filing
a bug with the authors of:

  ${highlight(formatPkgNameVer(problemDep))}
`;
  }

  return {
    title: err.message,
    body,
  };
}
