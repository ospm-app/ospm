import { type LogBase, type Logger, logger } from '../logger/index.ts';

export const fetchingProgressLogger = logger(
  'fetching-progress'
) as Logger<FetchingProgressMessage>;

export type FetchingProgressMessageBase = {
  attempt?: number | undefined;
  downloaded?: number | undefined;
  packageId: string;
  size?: number | null | undefined;
  status?: 'started' | 'in_progress' | undefined;
};

export interface FetchingProgressMessageStarted
  extends FetchingProgressMessageBase {
  attempt: number;
  size: number | null;
  status: 'started';
}

export interface FetchingProgressMessageInProgress
  extends FetchingProgressMessageBase {
  downloaded: number;
  status: 'in_progress';
}

export type FetchingProgressMessage =
  | FetchingProgressMessageStarted
  | FetchingProgressMessageInProgress;

export type FetchingProgressLog = { name: 'pnpm:fetching-progress' } & LogBase &
  FetchingProgressMessage;
