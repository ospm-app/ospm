export type AuditVulnerabilityCounts = {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
};

export type IgnoredAuditVulnerabilityCounts = {
  low: number;
  moderate: number;
  high: number;
  critical: number;
};

export type AuditResolution = {
  id: number;
  path: string;
  dev: boolean;
  optional: boolean;
  bundled: boolean;
};

export type AuditAction = {
  action: string;
  module: string;
  target: string;
  isMajor: boolean;
  resolves: AuditResolution[];
};

export type AuditLevelString = 'low' | 'moderate' | 'high' | 'critical';

export type AuditLevelNumber = 0 | 1 | 2 | 3;

export type AuditAdvisory = {
  findings: [
    {
      version: string;
      paths: string[];
      dev: boolean;
      optional: boolean;
      bundled: boolean;
    },
  ];
  id: number;
  created: string;
  updated: string;
  deleted?: boolean | undefined;
  title: string;
  found_by: {
    name: string;
  };
  reported_by: {
    name: string;
  };
  module_name: string;
  cves: string[];
  vulnerable_versions: string;
  patched_versions: string;
  overview: string;
  recommendation: string;
  references: string;
  access: string;
  severity: AuditLevelString;
  cwe: string;
  github_advisory_id: string;
  metadata: {
    module_type: string;
    exploitability: number;
    affected_components: string;
  };
  url: string;
};

export type AuditMetadata = {
  vulnerabilities: AuditVulnerabilityCounts;
  dependencies: number;
  devDependencies: number;
  optionalDependencies: number;
  totalDependencies: number;
};

export type AuditReport = {
  actions: AuditAction[];
  advisories: { [id: string]: AuditAdvisory };
  muted: unknown[];
  metadata: AuditMetadata;
};

export type AuditActionRecommendation = {
  cmd: string;
  isBreaking: boolean;
  action: AuditAction;
};
