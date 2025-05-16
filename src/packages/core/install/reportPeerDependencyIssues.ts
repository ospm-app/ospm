import { OspmError } from '../../error/index.ts';
import { peerDependencyIssuesLogger } from '../../core-loggers/index.ts';
import type {
  PeerDependencyIssues,
  PeerDependencyIssuesByProjects,
} from '../../types/index.ts';
import isEmpty from 'ramda/src/isEmpty';

export function reportPeerDependencyIssues(
  peerDependencyIssuesByProjects: PeerDependencyIssuesByProjects,
  opts: {
    lockfileDir: string;
    strictPeerDependencies: boolean;
  }
): void {
  if (
    Object.values(peerDependencyIssuesByProjects).every(
      (peerIssuesOfProject: PeerDependencyIssues): boolean => {
        return (
          isEmpty.default(peerIssuesOfProject.bad) &&
          (isEmpty.default(peerIssuesOfProject.missing) ||
            (peerIssuesOfProject.conflicts.length === 0 &&
              Object.keys(peerIssuesOfProject.intersections).length === 0))
        );
      }
    )
  ) {
    return;
  }

  if (opts.strictPeerDependencies) {
    throw new PeerDependencyIssuesError(peerDependencyIssuesByProjects);
  }

  peerDependencyIssuesLogger.debug({
    issuesByProjects: peerDependencyIssuesByProjects,
  });
}

export class PeerDependencyIssuesError extends OspmError {
  issuesByProjects: PeerDependencyIssuesByProjects;

  constructor(issues: PeerDependencyIssuesByProjects) {
    super('PEER_DEP_ISSUES', 'Unmet peer dependencies');

    this.issuesByProjects = issues;
  }
}
