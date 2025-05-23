import {
  audit,
  type AuditAdvisory,
  type AuditLevelNumber,
  type AuditLevelString,
  type AuditReport,
  type AuditVulnerabilityCounts,
  type IgnoredAuditVulnerabilityCounts,
} from '../audit/index.ts';
import { createGetAuthHeaderByURI } from '../network.auth-header/index.ts';
import { docsUrl, TABLE_OPTIONS } from '../cli-utils/index.ts';
import type {
  Config,
  UniversalOptions,
} from '../config/index.ts';
import {
  types as allTypes,
} from '../config/types.ts';
import { WANTED_LOCKFILE } from '../constants/index.ts';
import { OspmError } from '../error/index.ts';
import { readWantedLockfile } from '../lockfile.fs/index.ts';
import type { LockFileDir, Registries } from '../types/index.ts';
import { table } from '@zkochan/table';
import chalk, { type ChalkInstance } from 'chalk';
import difference from 'ramda/src/difference';
import pick from 'ramda/src/pick';
import pickBy from 'ramda/src/pickBy';
import renderHelp from 'render-help';
import { fix } from './fix.ts';

// eslint-disable
const AUDIT_LEVEL_NUMBER = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
} satisfies Record<AuditLevelString, AuditLevelNumber>;

const AUDIT_COLOR = {
  low: chalk.bold,
  moderate: chalk.bold.yellow,
  high: chalk.bold.red,
  critical: chalk.bold.red,
} satisfies Record<AuditLevelString, ChalkInstance>;

const AUDIT_TABLE_OPTIONS = {
  ...TABLE_OPTIONS,
  columns: {
    1: {
      width: 54, // = table width of 80
      wrapWord: true,
    },
  },
};
// eslint-enable

const MAX_PATHS_COUNT = 3;

export const rcOptionsTypes = cliOptionsTypes;

export function cliOptionsTypes(): Record<string, unknown> {
  return {
    ...pick.default(
      ['dev', 'json', 'only', 'optional', 'production', 'registry'],
      allTypes
    ),
    'audit-level': ['low', 'moderate', 'high', 'critical'],
    fix: Boolean,
    'ignore-registry-errors': Boolean,
  };
}

export const shorthands: Record<string, string> = {
  D: '--dev',
  P: '--production',
};

export const commandNames = ['audit'];

export function help(): string {
  return renderHelp({
    description:
      'Checks for known security issues with the installed packages.',
    descriptionLists: [
      {
        title: 'Options',

        list: [
          {
            description:
              'Add overrides to the package.json file in order to force non-vulnerable versions of the dependencies',
            name: '--fix',
          },
          {
            description: 'Output audit report in JSON format',
            name: '--json',
          },
          {
            description:
              'Only print advisories with severity greater than or equal to one of the following: low|moderate|high|critical. Default: low',
            name: '--audit-level <severity>',
          },
          {
            description: 'Only audit "devDependencies"',
            name: '--dev',
            shortAlias: '-D',
          },
          {
            description: 'Only audit "dependencies" and "optionalDependencies"',
            name: '--prod',
            shortAlias: '-P',
          },
          {
            description: 'Don\'t audit "optionalDependencies"',
            name: '--no-optional',
          },
          {
            description:
              'Use exit code 0 if the registry responds with an error. Useful when audit checks are used in CI. A build should fail because the registry has issues.',
            name: '--ignore-registry-errors',
          },
        ],
      },
    ],
    url: docsUrl('audit'),
    usages: ['ospm audit [options]'],
  });
}

export async function handler(
  opts: Pick<UniversalOptions, 'dir'> & {
    auditLevel?: 'low' | 'moderate' | 'high' | 'critical' | undefined;
    fix?: boolean | undefined;
    ignoreRegistryErrors?: boolean | undefined;
    json?: boolean | undefined;
    lockfileDir?: LockFileDir | undefined;
    registries: Registries;
  } & Pick<
      Config,
      | 'ca'
      | 'cert'
      | 'httpProxy'
      | 'httpsProxy'
      | 'key'
      | 'localAddress'
      | 'maxSockets'
      | 'noProxy'
      | 'strictSsl'
      | 'fetchRetries'
      | 'fetchRetryMaxtimeout'
      | 'fetchRetryMintimeout'
      | 'fetchRetryFactor'
      | 'fetchTimeout'
      | 'production'
      | 'dev'
      | 'optional'
      | 'userConfig'
      | 'rawConfig'
      | 'rootProjectManifest'
      | 'virtualStoreDirMaxLength'
    >
): Promise<{ exitCode: number; output: string }> {
  const lockfileDir = opts.lockfileDir ?? opts.dir;

  const lockfile = await readWantedLockfile(lockfileDir, {
    ignoreIncompatible: true,
  });

  if (lockfile == null) {
    throw new OspmError(
      'AUDIT_NO_LOCKFILE',
      `No ${WANTED_LOCKFILE} found: Cannot audit a project without a lockfile`
    );
  }

  const include = {
    dependencies: opts.production !== false,
    devDependencies: opts.dev !== false,
    optionalDependencies: opts.optional !== false,
  };

  let auditReport: AuditReport | undefined;

  const getAuthHeader = createGetAuthHeaderByURI({
    allSettings: opts.rawConfig,
    userSettings: opts.userConfig,
  });

  try {
    auditReport = await audit(lockfile, getAuthHeader, {
      agentOptions: {
        ca: opts.ca,
        cert: opts.cert,
        httpProxy: opts.httpProxy,
        httpsProxy: opts.httpsProxy,
        key: opts.key,
        localAddress: opts.localAddress,
        maxSockets: opts.maxSockets,
        noProxy: opts.noProxy,
        strictSsl: opts.strictSsl,
        timeout: opts.fetchTimeout,
      },
      include,
      lockfileDir,
      registry: opts.registries.default,
      retry: {
        factor: opts.fetchRetryFactor ?? 10,
        maxTimeout: opts.fetchRetryMaxtimeout ?? 60_000,
        minTimeout: opts.fetchRetryMintimeout ?? 10_000,
        retries: opts.fetchRetries ?? 3,
      },
      timeout: opts.fetchTimeout,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (opts.ignoreRegistryErrors === true) {
      return {
        exitCode: 0,
        output: err.message,
      };
    }

    throw err;
  }

  if (opts.fix === true) {
    const newOverrides = await fix(opts.dir, auditReport);

    if (Object.values(newOverrides).length === 0) {
      return {
        exitCode: 0,
        output: 'No fixes were made',
      };
    }

    return {
      exitCode: 0,
      output: `${Object.values(newOverrides).length} overrides were added to package.json to fix vulnerabilities.
Run "ospm install" to apply the fixes.

The added overrides:
${JSON.stringify(newOverrides, null, 2)}`,
    };
  }

  const vulnerabilities = auditReport.metadata.vulnerabilities;

  const ignoredVulnerabilities: IgnoredAuditVulnerabilityCounts = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  const totalVulnerabilityCount = Object.values(vulnerabilities).reduce(
    (sum: number, vulnerabilitiesCount: number) => sum + vulnerabilitiesCount,
    0
  );

  const ignoreGhsas = opts.rootProjectManifest?.ospm?.auditConfig?.ignoreGhsas;

  if (ignoreGhsas) {
    auditReport.advisories = pickBy.default(
      ({ github_advisory_id, severity }): boolean => {
        if (!ignoreGhsas.includes(github_advisory_id)) {
          return true;
        }

        ignoredVulnerabilities[severity as AuditLevelString] += 1;

        return false;
      },
      auditReport.advisories
    );
  }

  const ignoreCves = opts.rootProjectManifest?.ospm?.auditConfig?.ignoreCves;

  if (ignoreCves) {
    auditReport.advisories = pickBy.default(({ cves, severity }): boolean => {
      if (
        cves.length === 0 ||
        difference.default(cves, ignoreCves).length > 0
      ) {
        return true;
      }

      ignoredVulnerabilities[severity as AuditLevelString] += 1;

      return false;
    }, auditReport.advisories);
  }
  if (opts.json === true) {
    return {
      exitCode: totalVulnerabilityCount > 0 ? 1 : 0,
      output: JSON.stringify(auditReport, null, 2),
    };
  }

  let output = '';

  const auditLevel = AUDIT_LEVEL_NUMBER[opts.auditLevel ?? 'low'];

  let advisories = Object.values(auditReport.advisories);

  advisories = advisories
    .filter(({ severity }: AuditAdvisory): boolean => {
      return AUDIT_LEVEL_NUMBER[severity] >= auditLevel;
    })
    .sort((a1: AuditAdvisory, a2: AuditAdvisory): number => {
      return AUDIT_LEVEL_NUMBER[a2.severity] - AUDIT_LEVEL_NUMBER[a1.severity];
    });

  for (const advisory of advisories) {
    const paths = advisory.findings.flatMap(({ paths }) => paths);

    output += table(
      [
        [
          AUDIT_COLOR[advisory.severity](advisory.severity),
          chalk.bold(advisory.title),
        ],
        ['Package', advisory.module_name],
        ['Vulnerable versions', advisory.vulnerable_versions],
        ['Patched versions', advisory.patched_versions],
        [
          'Paths',
          (paths.length > MAX_PATHS_COUNT
            ? paths
                .slice(0, MAX_PATHS_COUNT)
                .concat([
                  `... Found ${paths.length} paths, run \`ospm why ${advisory.module_name}\` for more information`,
                ])
            : paths
          ).join('\n\n'),
        ],
        ['More info', advisory.url],
      ],
      AUDIT_TABLE_OPTIONS
    );
  }

  return {
    exitCode: output ? 1 : 0,
    output: `${output}${reportSummary(auditReport.metadata.vulnerabilities, totalVulnerabilityCount, ignoredVulnerabilities)}`,
  };
}

function reportSummary(
  vulnerabilities: AuditVulnerabilityCounts,
  totalVulnerabilityCount: number,
  ignoredVulnerabilities: IgnoredAuditVulnerabilityCounts
): string {
  if (totalVulnerabilityCount === 0) {
    return 'No known vulnerabilities found\n';
  }

  return `${chalk.red(totalVulnerabilityCount)} vulnerabilities found\nSeverity: ${Object.entries(
    vulnerabilities
  )
    .filter(([_auditLevel, vulnerabilitiesCount]): boolean => {
      return vulnerabilitiesCount > 0;
    })
    .map(([auditLevel, vulnerabilitiesCount]: [string, number]): string => {
      return AUDIT_COLOR[auditLevel as AuditLevelString](
        `${vulnerabilitiesCount} ${auditLevel}${ignoredVulnerabilities[auditLevel as AuditLevelString] > 0 ? ` (${ignoredVulnerabilities[auditLevel as AuditLevelString]} ignored)` : ''}`
      );
    })
    .join(' | ')}`;
}
