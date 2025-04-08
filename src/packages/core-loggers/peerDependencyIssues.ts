import { type LogBase, type Logger, logger } from '../logger/index.ts';
import type { PeerDependencyIssuesByProjects } from '../types/index.ts';

export const peerDependencyIssuesLogger = logger(
  'peer-dependency-issues'
) as Logger<PeerDependencyIssuesMessage>;

export interface PeerDependencyIssuesMessage {
  issuesByProjects: PeerDependencyIssuesByProjects;
}

export type PeerDependencyIssuesLog = {
  name: 'pnpm:peer-dependency-issues';
} & LogBase &
  PeerDependencyIssuesMessage;
