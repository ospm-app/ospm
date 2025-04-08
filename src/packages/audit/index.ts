import assert from 'node:assert';
import path from 'node:path';
import util from 'node:util';
import { PnpmError } from '../error/index.ts';
import {
  type AgentOptions,
  fetchWithAgent,
  type RetryTimeoutOptions,
} from '../fetch/index.ts';
import type { GetAuthHeader } from '../fetching-types/index.ts';
import type { LockfileObject } from '../lockfile.types/index.ts';
import { globalWarn } from '../logger/index.ts';
import type { DependenciesField } from '../types/index.ts';
import { lockfileToAuditTree } from './lockfileToAuditTree.ts';
import type { AuditReport } from './types.ts';
import { searchForPackages, flattenSearchedPackages } from '../list/index.ts';

export * from './types.ts';

export async function audit(
  lockfile: LockfileObject,
  getAuthHeader: GetAuthHeader,
  opts: {
    agentOptions?: AgentOptions | undefined;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    lockfileDir: string;
    registry: string;
    retry?: RetryTimeoutOptions | undefined;
    timeout?: number | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<AuditReport> {
  const auditTree = await lockfileToAuditTree(lockfile, {
    include: opts.include,
    lockfileDir: opts.lockfileDir,
  });

  const registry = opts.registry.endsWith('/')
    ? opts.registry
    : `${opts.registry}/`;

  const auditUrl = `${registry}-/npm/v1/security/audits`;

  const authHeaderValue = getAuthHeader(registry);

  const authHeaders = getAuthHeaders(authHeaderValue);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (typeof authHeaders.authorization !== 'undefined') {
    headers.authorization = authHeaders.authorization;
  }

  const res = await fetchWithAgent(auditUrl, {
    agentOptions: opts.agentOptions ?? {},
    body: JSON.stringify(auditTree),
    headers,
    method: 'post',
    retry: opts.retry,
    timeout: opts.timeout,
  });

  if (res.status === 404) {
    throw new AuditEndpointNotExistsError(auditUrl);
  }

  if (res.status !== 200) {
    throw new PnpmError(
      'AUDIT_BAD_RESPONSE',
      `The audit endpoint (at ${auditUrl}) responded with ${res.status}: ${await res.text()}`
    );
  }

  // TODO: valibot schema
  const auditReport: AuditReport = (await res.json()) as AuditReport;

  try {
    return await extendWithDependencyPaths(auditReport, {
      lockfile,
      lockfileDir: opts.lockfileDir,
      include: opts.include,
      virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
    });
  } catch (err: unknown) {
    assert(util.types.isNativeError(err));

    globalWarn(
      `Failed to extend audit report with dependency paths: ${err.message}`
    );

    return auditReport;
  }
}

type AuthHeaders = {
  authorization?: string | undefined;
};

function getAuthHeaders(authHeaderValue: string | undefined): AuthHeaders {
  const headers: AuthHeaders = {};

  if (typeof authHeaderValue === 'string') {
    headers.authorization = authHeaderValue;
  }

  return headers;
}

async function extendWithDependencyPaths(
  auditReport: AuditReport,
  opts: {
    lockfile: LockfileObject;
    lockfileDir: string;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    virtualStoreDirMaxLength: number;
  }
): Promise<AuditReport> {
  const { advisories } = auditReport;

  if (!Object.keys(advisories).length) {
    return auditReport;
  }

  const projectDirs = Object.keys(opts.lockfile.importers ?? {}).map(
    (importerId) => {
      return path.join(opts.lockfileDir, importerId);
    }
  );

  const searchOpts = {
    lockfileDir: opts.lockfileDir,
    depth: Number.POSITIVE_INFINITY,
    include: opts.include,
    virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength,
  };

  const _searchPackagePaths = searchPackagePaths.bind(
    null,
    searchOpts,
    projectDirs
  );

  await Promise.all(
    Object.values(advisories).map(async ({ findings, module_name }) => {
      await Promise.all(
        findings.map(async (finding) => {
          finding.paths = await _searchPackagePaths(
            `${module_name}@${finding.version}`
          );
        })
      );
    })
  );

  return auditReport;
}

async function searchPackagePaths(
  searchOpts: {
    lockfileDir: string;
    depth: number;
    include?: { [dependenciesField in DependenciesField]: boolean } | undefined;
    virtualStoreDirMaxLength: number;
  },
  projectDirs: string[],
  pkg: string
): Promise<string[]> {
  const pkgs = await searchForPackages([pkg], projectDirs, searchOpts);

  return flattenSearchedPackages(pkgs, {
    lockfileDir: searchOpts.lockfileDir,
  }).map(({ depPath }) => depPath);
}

export class AuditEndpointNotExistsError extends PnpmError {
  constructor(endpoint: string) {
    const message = `The audit endpoint (at ${endpoint}) is doesn't exist.`;

    super('AUDIT_ENDPOINT_NOT_EXISTS', message, {
      hint: "This issue is probably because you are using a private npm registry and that endpoint doesn't have an implementation of audit.",
    });
  }
}
