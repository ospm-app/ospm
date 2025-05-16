import path from 'node:path';
import type {
  IgnoredScriptsLog,
  DeprecationLog,
  PackageManifestLog,
  RootLog,
  SummaryLog,
} from '../../core-loggers/index.ts';
import type { Config } from '../../config/index.ts';
import { lexCompare } from '../../util.lex-comparator/index.ts';
import * as Rx from 'rxjs';
import { map, take } from 'rxjs/operators';
import boxen from '@zkochan/boxen';
import chalk from 'chalk';
import semver from 'semver';
import { EOL } from '../constants.ts';
import {
  getPkgsDiff,
  type PackageDiff,
  propertyByDependencyType,
} from './pkgsDiff.ts';
import { ADDED_CHAR, REMOVED_CHAR } from './outputConstants.ts';

const depTypes = [
  'prod',
  'optional',
  'peer',
  'dev',
  'nodeModulesOnly',
] as const;

type DepType = 'prod' | 'optional' | 'peer' | 'dev' | 'nodeModulesOnly';

type ConfigByDepType = 'production' | 'dev' | 'optional';

const CONFIG_BY_DEP_TYPE: Partial<Record<DepType, ConfigByDepType>> = {
  prod: 'production',
  dev: 'dev',
  optional: 'optional',
};

export function reportSummary(
  log$: {
    deprecation: Rx.Observable<DeprecationLog>;
    summary: Rx.Observable<SummaryLog>;
    root: Rx.Observable<RootLog>;
    packageManifest: Rx.Observable<PackageManifestLog>;
    ignoredScripts: Rx.Observable<IgnoredScriptsLog>;
  },
  opts: {
    cmd: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    filterPkgsDiff?: FilterPkgsDiff | undefined;
    ospmConfig?: Config | undefined;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  const pkgsDiff$ = getPkgsDiff(log$, { prefix: opts.cwd });

  const summaryLog$ = log$.summary.pipe(take(1));

  const _printDiffs = printDiffs.bind(null, {
    cmd: opts.cmd,
    prefix: opts.cwd,
    ospmConfig: opts.ospmConfig,
  });

  return Rx.combineLatest(
    pkgsDiff$,
    log$.ignoredScripts.pipe(Rx.startWith({ packageNames: undefined })),
    summaryLog$
  ).pipe(
    take(1),
    map(([pkgsDiff, ignoredScripts]) => {
      let msg = '';
      for (const depType of depTypes) {
        let diffs: PackageDiff[] = Object.values(
          pkgsDiff[depType as keyof typeof pkgsDiff]
        );

        if (typeof opts.filterPkgsDiff === 'function') {
          // This filtering is only used by Bit CLI currently.
          // Related PR: https://github.com/teambit/bit/pull/7176
          diffs = diffs.filter((pkgDiff) => {
            if (typeof opts.filterPkgsDiff === 'function') {
              return opts.filterPkgsDiff(pkgDiff);
            }

            return false;
          });
        }

        if (diffs.length > 0) {
          msg += EOL;

          if (opts.ospmConfig?.global === true) {
            msg += chalk.cyanBright(`${opts.cwd}:`);
          } else {
            msg += chalk.cyanBright(
              `${propertyByDependencyType[depType] as string}:`
            );
          }
          msg += EOL;
          msg += _printDiffs(diffs, depType);
          msg += EOL;
        } else if (
          CONFIG_BY_DEP_TYPE[depType] &&
          opts.ospmConfig?.[CONFIG_BY_DEP_TYPE[depType]] === false
        ) {
          msg += EOL;
          msg += `${chalk.cyanBright(`${propertyByDependencyType[depType] as string}:`)} skipped`;
          msg += EOL;
        }
      }
      if (
        ignoredScripts.packageNames &&
        ignoredScripts.packageNames.length > 0 &&
        opts.ospmConfig?.strictDepBuilds !== true
      ) {
        msg += EOL;
        msg += boxen(
          `Ignored build scripts: ${Array.from(ignoredScripts.packageNames).sort(lexCompare).join(', ')}.
Run "ospm approve-builds${opts.ospmConfig?.cliOptions.global === true ? ' -g' : ''}" to pick which dependencies should be allowed to run scripts.`,
          {
            title: 'Warning',
            padding: 1,
            margin: 0,
            borderStyle: 'round',
            borderColor: 'yellow',
          }
        );
        msg += EOL;
      }
      return Rx.of({ msg });
    })
  );
}

export type FilterPkgsDiff = (pkgsDiff: PackageDiff) => boolean;

function printDiffs(
  opts: {
    cmd: string;
    prefix: string;
    ospmConfig?: Config | undefined;
  },
  pkgsDiff: PackageDiff[],
  depType: string
): string {
  // Sorts by alphabet then by removed/added
  // + ava 0.10.0
  // - chalk 1.0.0
  // + chalk 2.0.0
  pkgsDiff.sort(
    (a, b) =>
      a.name.localeCompare(b.name) * 10 + (Number(!b.added) - Number(!a.added))
  );
  const msg = pkgsDiff
    .map((pkg) => {
      let result = pkg.added ? ADDED_CHAR : REMOVED_CHAR;

      if (typeof pkg.realName === 'undefined' || pkg.name === pkg.realName) {
        result += ` ${pkg.name}`;
      } else {
        result += ` ${pkg.name} <- ${pkg.realName}`;
      }

      if (typeof pkg.version === 'string') {
        result += ` ${chalk.grey(pkg.version)}`;
        if (
          typeof pkg.latest === 'string' &&
          semver.lt(pkg.version, pkg.latest)
        ) {
          result += ` ${chalk.grey(`(${pkg.latest} is available)`)}`;
        }
      }

      if (pkg.deprecated === true) {
        result += ` ${chalk.red('deprecated')}`;
      }

      if (typeof pkg.from === 'string') {
        result += ` ${chalk.grey(`<- ${(pkg.from && path.relative(opts.prefix, pkg.from)) || '???'}`)}`;
      }

      if (
        pkg.added &&
        depType === 'dev' &&
        opts.ospmConfig?.saveDev === false &&
        opts.cmd === 'add'
      ) {
        result += `${chalk.yellow(' already in devDependencies, was not moved to dependencies.')}`;
      }
      return result;
    })
    .join(EOL);

  return msg;
}
