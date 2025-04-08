import type {
  ContextLog,
  DeprecationLog,
  FetchingProgressLog,
  ExecutionTimeLog,
  HookLog,
  InstallCheckLog,
  IgnoredScriptsLog,
  LifecycleLog,
  LinkLog,
  PackageImportMethodLog,
  PackageManifestLog,
  PeerDependencyIssuesLog,
  ProgressLog,
  RegistryLog,
  RequestRetryLog,
  RootLog,
  ScopeLog,
  SkippedOptionalDependencyLog,
  StageLog,
  StatsLog,
  SummaryLog,
  UpdateCheckLog,
} from './all.ts';

export * from './all.ts';

export type Log =
  | ContextLog
  | DeprecationLog
  | FetchingProgressLog
  | ExecutionTimeLog
  | HookLog
  | InstallCheckLog
  | IgnoredScriptsLog
  | LifecycleLog
  | LinkLog
  | PackageManifestLog
  | PackageImportMethodLog
  | PeerDependencyIssuesLog
  | ProgressLog
  | RegistryLog
  | RequestRetryLog
  | RootLog
  | ScopeLog
  | SkippedOptionalDependencyLog
  | StageLog
  | StatsLog
  | SummaryLog
  | UpdateCheckLog;
