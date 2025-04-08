export type ParentPackages = Array<{ name: string; version: string }>;

export type MissingPeerDependencyIssue = {
  parents: ParentPackages;
  optional: boolean;
  wantedRange: string;
};

export type MissingPeerIssuesByPeerName = Record<
  string,
  MissingPeerDependencyIssue[]
>;

export interface BadPeerDependencyIssue extends MissingPeerDependencyIssue {
  foundVersion: string;
  resolvedFrom: ParentPackages;
}

export type BadPeerIssuesByPeerName = Record<string, BadPeerDependencyIssue[]>;

export type PeerDependencyIssuesByProjects = Record<
  string,
  PeerDependencyIssues
>;

export type PeerDependencyIssues = {
  bad: BadPeerIssuesByPeerName;
  missing: MissingPeerIssuesByPeerName;
  conflicts: string[];
  intersections: Record<string, string>;
};
