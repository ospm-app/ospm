export type DedupeCheckIssues = {
  readonly importerIssuesByImporterId: SnapshotsChanges;
  readonly packageIssuesByDepPath: SnapshotsChanges;
};

export type SnapshotsChanges = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly updated: Record<string, ResolutionChangesByAlias>;
};

export type ResolutionChangesByAlias = Record<string, ResolutionChange>;

export type ResolutionChange =
  | ResolutionAdded
  | ResolutionDeleted
  | ResolutionUpdated;

export type ResolutionAdded = {
  readonly type: 'added';
  readonly next: string;
};

export type ResolutionDeleted = {
  readonly type: 'removed';
  readonly prev: string;
};

export type ResolutionUpdated = {
  readonly type: 'updated';
  readonly prev: string;
  readonly next: string;
};
