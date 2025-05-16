import { type LogBase, logger } from '../logger/index.ts';

export const requestRetryLogger = logger<RequestRetryMessage>('request-retry');

export interface RequestRetryError extends Error {
  httpStatusCode?: string | undefined;
  status?: string | undefined;
  errno?: number | undefined;
  code?: string | undefined;
}

export type RequestRetryMessage = {
  attempt: number;
  error: RequestRetryError;
  maxRetries: number;
  method: string;
  timeout: number;
  url: string;
};

export type RequestRetryLog = { name: 'ospm:request-retry' } & LogBase &
  RequestRetryMessage;
