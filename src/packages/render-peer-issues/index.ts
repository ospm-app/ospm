import { OspmError } from '../error/index.ts';
import { createMatcher } from '../matcher/index.ts';
import type {
  BadPeerDependencyIssue,
  PeerDependencyIssuesByProjects,
  PeerDependencyRules,
} from '../types/index.ts';
import {
  parseOverrides,
  type PackageSelector,
  type VersionOverride,
} from '../parse-overrides/index.ts';
import archy from 'archy';
import chalk from 'chalk';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import cliColumns from 'cli-columns';
import semver from 'semver';

export function renderPeerIssues(
  peerDependencyIssuesByProjects: PeerDependencyIssuesByProjects,
  opts?:
    | {
        rules?: PeerDependencyRules | undefined;
        width?: number | undefined;
      }
    | undefined
): string {
  const ignoreMissingPatterns = [...new Set(opts?.rules?.ignoreMissing ?? [])];

  const ignoreMissingMatcher = createMatcher(ignoreMissingPatterns);

  const allowAnyPatterns = [...new Set(opts?.rules?.allowAny ?? [])];

  const allowAnyMatcher = createMatcher(allowAnyPatterns);

  const { allowedVersionsMatchAll, allowedVersionsByParentPkgName } =
    parseAllowedVersions(opts?.rules?.allowedVersions ?? {});

  const projects = {} as Record<string, PkgNode>;

  for (const [
    projectId,
    { bad, missing, conflicts, intersections },
  ] of Object.entries(peerDependencyIssuesByProjects)) {
    projects[projectId] = { dependencies: {}, peerIssues: [] };

    for (const [peerName, issues] of Object.entries(missing)) {
      if (
        (!conflicts.includes(peerName) && intersections[peerName] == null) ||
        ignoreMissingMatcher(peerName)
      ) {
        continue;
      }

      for (const issue of issues) {
        createTree(
          projects[projectId],
          issue.parents,
          `${chalk.red('✕ missing peer')} ${formatNameAndRange(peerName, issue.wantedRange)}`
        );
      }
    }

    for (const [peerName, issues] of Object.entries(bad)) {
      if (allowAnyMatcher(peerName)) {
        continue;
      }

      for (const issue of issues) {
        if (
          allowedVersionsMatchAll[peerName]?.some((range) => {
            return semver.satisfies(issue.foundVersion, range);
          }) === true
        ) {
          continue;
        }

        const currentParentPkg = issue.parents.at(-1);

        if (
          currentParentPkg &&
          allowedVersionsByParentPkgName[peerName]?.[currentParentPkg.name]
        ) {
          const allowedVersionsByParent: Record<string, string[]> = {};

          for (const {
            targetPkg,
            parentPkg,
            ranges,
          } of allowedVersionsByParentPkgName[peerName][
            currentParentPkg.name
          ] ?? []) {
            if (
              typeof parentPkg.pref === 'undefined' ||
              (currentParentPkg.version &&
                (isSubRange(parentPkg.pref, currentParentPkg.version) ||
                  semver.satisfies(currentParentPkg.version, parentPkg.pref)))
            ) {
              allowedVersionsByParent[targetPkg.name] = ranges;
            }
          }

          if (
            allowedVersionsByParent[peerName]?.some((range) =>
              semver.satisfies(issue.foundVersion, range)
            ) === true
          ) {
            continue;
          }
        }

        createTree(
          projects[projectId],
          issue.parents,
          formatUnmetPeerMessage({
            peerName,
            ...issue,
          })
        );
      }
    }
  }

  const cliColumnsOptions = {
    newline: '\n  ',
    width: (opts?.width ?? process.stdout.columns) - 2,
  };

  return Object.entries(projects)
    .filter(([, project]: [string, PkgNode]): boolean => {
      return Object.keys(project.dependencies).length > 0;
    })
    .sort(
      (
        [projectKey1]: [string, PkgNode],
        [projectKey2]: [string, PkgNode]
      ): number => {
        return projectKey1.localeCompare(projectKey2);
      }
    )
    .map(([projectKey, project]: [string, PkgNode]): string => {
      const summaries = [];

      const peerDependencyIssues = peerDependencyIssuesByProjects[projectKey];

      if (typeof peerDependencyIssues === 'undefined') {
        return '';
      }

      const { conflicts, intersections } = peerDependencyIssues;

      if (conflicts.length) {
        summaries.push(
          chalk.red(
            `✕ Conflicting peer dependencies:\n  ${cliColumns(conflicts, cliColumnsOptions).trimEnd()}`
          )
        );
      }

      if (Object.keys(intersections).length) {
        summaries.push(
          `Peer dependencies that should be installed:\n  ${cliColumns(
            Object.entries(intersections).map(([name, version]) =>
              formatNameAndRange(name, version)
            ),
            cliColumnsOptions
          )}`
        );
      }

      const title = chalk.reset(projectKey);

      const summariesConcatenated = summaries.join('\n');

      return `${archy(toArchyData(title, project))}${summariesConcatenated}`.trimEnd();
    })
    .join('\n\n');
}

function formatUnmetPeerMessage({
  foundVersion,
  peerName,
  wantedRange,
  resolvedFrom,
}: BadPeerDependencyIssue & {
  peerName: string;
}): string {
  const nameAndRange = formatNameAndRange(peerName, wantedRange);

  if (Array.isArray(resolvedFrom) && resolvedFrom.length > 0) {
    return `✕ unmet peer ${nameAndRange}: found ${foundVersion} in ${resolvedFrom[resolvedFrom.length - 1]?.name ?? ''}`;
  }

  return `${chalk.yellowBright('✕ unmet peer')} ${nameAndRange}: found ${foundVersion}`;
}

function formatNameAndRange(name: string, range: string): string {
  if (range.includes(' ') || range === '*') {
    return `${name}@"${range}"`;
  }

  return `${name}@${range}`;
}

type PkgNode = {
  peerIssues: string[];
  dependencies: Record<string, PkgNode>;
};

function createTree(
  pkgNode: PkgNode,
  pkgs: Array<{ name: string; version: string }>,
  issueText: string
): void {
  let newPkgs: Array<{ name: string; version: string }> = [];

  if (pkgs.length === 0) {
    // This will happen if incorrect data is passed to the reporter.
    // It is better to print something instead of crashing.
    newPkgs = [{ name: '<unknown>', version: '<unknown>' }];
  }

  const [pkg, ...rest] = newPkgs;

  if (typeof pkg === 'undefined') {
    return;
  }

  const label = `${pkg.name} ${chalk.grey(pkg.version)}`;

  if (!pkgNode.dependencies[label]) {
    pkgNode.dependencies[label] = { dependencies: {}, peerIssues: [] };
  }

  if (rest.length === 0) {
    pkgNode.dependencies[label].peerIssues.push(issueText);
    return;
  }

  createTree(pkgNode.dependencies[label], rest, issueText);
}

function toArchyData(depName: string, pkgNode: PkgNode): archy.Data {
  const result: Required<archy.Data> = {
    label: depName,
    nodes: [],
  };

  for (const wantedPeer of pkgNode.peerIssues) {
    result.nodes?.push(wantedPeer);
  }

  for (const [depName, node] of Object.entries(pkgNode.dependencies)) {
    result.nodes?.push(toArchyData(depName, node));
  }

  return result;
}

type AllowedVersionsByParentPkgName = Record<
  string,
  Record<
    string,
    Array<
      Required<Pick<VersionOverride, 'parentPkg' | 'targetPkg'>> & {
        ranges: string[];
      }
    >
  >
>;

interface ParsedAllowedVersions {
  allowedVersionsMatchAll: Record<string, string[]>;
  allowedVersionsByParentPkgName: AllowedVersionsByParentPkgName;
}

function parseAllowedVersions(
  allowedVersions: Record<string, string>
): ParsedAllowedVersions {
  const overrides = tryParseAllowedVersions(allowedVersions);

  const allowedVersionsMatchAll: Record<string, string[]> = {};

  const allowedVersionsByParentPkgName: AllowedVersionsByParentPkgName = {};

  for (const override of overrides) {
    const ranges = parseVersions(override.newPref);

    if (!('parentPkg' in override)) {
      allowedVersionsMatchAll[override.targetPkg.name] = ranges;

      continue;
    }

    const allowedPkgs = allowedVersionsByParentPkgName[override.targetPkg.name];

    if (typeof allowedPkgs === 'undefined') {
      allowedVersionsByParentPkgName[override.targetPkg.name] = {};
    }

    if (
      typeof allowedPkgs !== 'undefined' &&
      typeof allowedPkgs[override.parentPkg.name] === 'undefined'
    ) {
      allowedPkgs[override.parentPkg.name] = [];
    }

    allowedPkgs?.[override.parentPkg.name]?.push({
      parentPkg: override.parentPkg,
      targetPkg: override.targetPkg,
      ranges,
    });
  }

  return {
    allowedVersionsMatchAll,
    allowedVersionsByParentPkgName,
  };
}

function tryParseAllowedVersions(
  allowedVersions: Record<string, string>
): Array<
  | {
      parentPkg: PackageSelector;
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
  | {
      targetPkg: PackageSelector;
      selector: string;
      newPref: string;
    }
> {
  try {
    return parseOverrides(allowedVersions);
  } catch (err) {
    throw new OspmError(
      'INVALID_ALLOWED_VERSION_SELECTOR',
      `${(err as OspmError).message} in ospm.peerDependencyRules.allowedVersions`
    );
  }
}

function parseVersions(versions: string): string[] {
  return versions.split('||').map((v) => v.trim());
}

function isSubRange(superRange: string | undefined, subRange: string): boolean {
  return (
    typeof superRange === 'undefined' ||
    subRange === superRange ||
    (semver.validRange(subRange) != null &&
      semver.validRange(superRange) != null &&
      semver.subset(subRange, superRange))
  );
}
